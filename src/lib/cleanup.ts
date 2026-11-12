/**
 * Keeps the database inside a small (free) plan.
 *
 * Runs about once a day (see runCleanupIfDue). Two kinds of work:
 *
 *  ALWAYS (cheap, safe - this is just "keep the plan's promise"):
 *    - post_metrics: keep only the newest few snapshots per post
 *    - posts: keep only the plan depth (latest N reels, a few photos) per account.
 *      Reels someone saved as an idea are never removed.
 *    - bookkeeping: mark accounts nobody tracks, un-mark ones tracked again
 *
 *  ONLY WHEN THE DATABASE IS FILLING UP (>= CLEANUP_AT_PERCENT of DB_LIMIT_MB):
 *    - delete accounts nobody has tracked for ORPHAN_DAYS (never Discover
 *      accounts, never an account with a saved reel)
 *    - drop the tracking links of users unseen for INACTIVE_DAYS. The USER stays
 *      (email, plan, saved ideas); their accounts then age out as orphans.
 *
 * Below the threshold the second group only REPORTS what it would do.
 */
import { query, queryOne } from "./db";
import { config } from "./config";
import { REELS_PER_ACCOUNT } from "./plans";

export interface CleanupReport {
  at: string;
  dbMb: number;
  limitMb: number;
  percentFull: number;
  /** True when the database is full enough that whole accounts may be deleted. */
  deleting: boolean;
  metricsPruned: number;
  postsTrimmed: number;
  orphansMarked: number;
  orphansCleared: number;
  /** Accounts nobody has tracked for long enough to be deleted. */
  accountsDue: number;
  accountsDeleted: number;
  /** Users unseen for long enough to lose their tracking links. */
  inactiveUsers: number;
  trackingLinksRemoved: number;
  error?: string;
}

export async function databaseSizeMb(): Promise<number> {
  const row = await queryOne<{ bytes: string }>(
    `SELECT pg_database_size(current_database())::text AS bytes`
  );
  return Number(row?.bytes ?? 0) / (1024 * 1024);
}

const round1 = (n: number) => Math.round(n * 10) / 10;

export async function runCleanup(
  opts: { forceDeleting?: boolean } = {}
): Promise<CleanupReport> {
  const s = config.storage;
  const dbMb = await databaseSizeMb();
  const percentFull = (dbMb / s.limitMb) * 100;
  const deleting = opts.forceDeleting ?? percentFull >= s.cleanupAtPercent;

  const report: CleanupReport = {
    at: new Date().toISOString(),
    dbMb: round1(dbMb),
    limitMb: s.limitMb,
    percentFull: round1(percentFull),
    deleting,
    metricsPruned: 0,
    postsTrimmed: 0,
    orphansMarked: 0,
    orphansCleared: 0,
    accountsDue: 0,
    accountsDeleted: 0,
    inactiveUsers: 0,
    trackingLinksRemoved: 0,
  };

  // ---- always: snapshot history -------------------------------------------
  const pruned = await query(
    `
    DELETE FROM post_metrics WHERE id IN (
      SELECT id FROM (
        SELECT id, ROW_NUMBER() OVER (
                 PARTITION BY shortcode ORDER BY captured_at DESC
               ) AS rn
        FROM post_metrics
      ) t WHERE t.rn > $1
    ) RETURNING 1
    `,
    [config.metrics.keepSnapshots]
  );
  report.metricsPruned = pruned.length;

  // ---- always: plan depth per account -------------------------------------
  // Reels beyond the newest N, photos beyond the newest few. Saved ideas stay.
  const trimmed = await query<{ competitor_id: number }>(
    `
    DELETE FROM posts WHERE shortcode IN (
      SELECT r.shortcode FROM (
        SELECT p.shortcode, p.is_reel,
               ROW_NUMBER() OVER (
                 PARTITION BY p.competitor_id, p.is_reel ORDER BY p.posted_at DESC
               ) AS rn
        FROM posts p
      ) r
      WHERE r.rn > CASE WHEN r.is_reel THEN $1::int ELSE $2::int END
    )
    AND shortcode NOT IN (SELECT shortcode FROM user_watchlist)
    AND shortcode NOT IN (SELECT shortcode FROM watchlist)
    RETURNING competitor_id
    `,
    [REELS_PER_ACCOUNT, s.nonReelsKept]
  );
  report.postsTrimmed = trimmed.length;
  if (trimmed.length > 0) {
    const ids = [...new Set(trimmed.map((r) => r.competitor_id))];
    await query(
      `UPDATE competitors c
       SET post_count = (SELECT COUNT(*) FROM posts p WHERE p.competitor_id = c.id)
       WHERE c.id = ANY($1::int[])`,
      [ids]
    );
  }

  // ---- always: who is tracked ---------------------------------------------
  const marked = await query(
    `
    UPDATE competitors c SET orphaned_at = now()
    WHERE c.orphaned_at IS NULL AND NOT c.is_curated
      AND NOT EXISTS (SELECT 1 FROM user_competitors uc WHERE uc.competitor_id = c.id)
    RETURNING 1
    `
  );
  report.orphansMarked = marked.length;
  const cleared = await query(
    `
    UPDATE competitors c SET orphaned_at = NULL
    WHERE c.orphaned_at IS NOT NULL
      AND (c.is_curated
           OR EXISTS (SELECT 1 FROM user_competitors uc WHERE uc.competitor_id = c.id))
    RETURNING 1
    `
  );
  report.orphansCleared = cleared.length;

  // ---- accounts nobody tracks for a while ---------------------------------
  const dueWhere = `
    c.orphaned_at IS NOT NULL
    AND c.orphaned_at <= now() - make_interval(days => $1::int)
    AND NOT c.is_curated
    AND NOT EXISTS (SELECT 1 FROM user_competitors uc WHERE uc.competitor_id = c.id)
    AND NOT EXISTS (
      SELECT 1 FROM posts p
      WHERE p.competitor_id = c.id
        AND (p.shortcode IN (SELECT shortcode FROM user_watchlist)
             OR p.shortcode IN (SELECT shortcode FROM watchlist))
    )`;
  const due = await queryOne<{ n: string }>(
    `SELECT COUNT(*)::text AS n FROM competitors c WHERE ${dueWhere}`,
    [s.orphanDays]
  );
  report.accountsDue = Number(due?.n ?? 0);
  if (deleting && report.accountsDue > 0) {
    const gone = await query(
      `DELETE FROM competitors c WHERE ${dueWhere} RETURNING 1`,
      [s.orphanDays]
    );
    report.accountsDeleted = gone.length;
  }

  // ---- users unseen for a long time ---------------------------------------
  // Only their tracking links go. The user, email, plan and saved ideas stay.
  const inactive = await query<{ id: string }>(
    `
    SELECT u.id FROM users u
    WHERE NOT u.is_admin
      AND u.last_seen_at < now() - make_interval(days => $1::int)
      AND EXISTS (SELECT 1 FROM user_competitors uc WHERE uc.user_id = u.id)
    `,
    [s.inactiveDays]
  );
  report.inactiveUsers = inactive.length;
  if (deleting && inactive.length > 0) {
    const links = await query(
      `DELETE FROM user_competitors WHERE user_id = ANY($1::bigint[]) RETURNING 1`,
      [inactive.map((u) => u.id)]
    );
    report.trackingLinksRemoved = links.length;
  }

  return report;
}

/**
 * Runs the clean-up at most once per ~day however often this is called.
 * The claim is one atomic statement, so two overlapping requests never both run.
 * Returns the report, or null when it already ran recently.
 */
export async function runCleanupIfDue(): Promise<CleanupReport | null> {
  const claimed = await queryOne(
    `
    INSERT INTO maintenance (job, ran_at) VALUES ('cleanup', now())
    ON CONFLICT (job) DO UPDATE SET ran_at = now()
      WHERE maintenance.ran_at < now() - interval '23 hours'
    RETURNING job
    `
  );
  if (!claimed) return null;

  let report: CleanupReport;
  try {
    report = await runCleanup();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("cleanup failed:", message);
    report = { ...emptyReport(), error: message };
  }
  await query(`UPDATE maintenance SET report = $1::jsonb WHERE job = 'cleanup'`, [
    JSON.stringify(report),
  ]);
  return report;
}

function emptyReport(): CleanupReport {
  return {
    at: new Date().toISOString(), dbMb: 0, limitMb: config.storage.limitMb,
    percentFull: 0, deleting: false, metricsPruned: 0, postsTrimmed: 0,
    orphansMarked: 0, orphansCleared: 0, accountsDue: 0, accountsDeleted: 0,
    inactiveUsers: 0, trackingLinksRemoved: 0,
  };
}

/** For the admin page: how full is the database, and what did clean-up last do. */
export async function storageStatus() {
  const dbMb = await databaseSizeMb();
  const last = await queryOne<{ ran_at: string; report: CleanupReport | null }>(
    `SELECT ran_at, report FROM maintenance WHERE job = 'cleanup'`
  );
  return {
    dbMb: round1(dbMb),
    limitMb: config.storage.limitMb,
    percentFull: round1((dbMb / config.storage.limitMb) * 100),
    cleanupAtPercent: config.storage.cleanupAtPercent,
    orphanDays: config.storage.orphanDays,
    inactiveDays: config.storage.inactiveDays,
    lastCleanupAt: last?.ran_at ?? null,
    lastReport: last?.report ?? null,
  };
}
