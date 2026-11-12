import { randomBytes } from "node:crypto";
import { query, queryOne } from "./db";
import { config } from "./config";
import { startRun, CollectorHttpError, type Tier } from "./apify";
import { getAdapter } from "./actors";
import { CURATED_REFRESH_HOURS, planOf } from "./plans";
import {
  checkToken,
  getUserToken,
  saveCheck,
  setStatus,
} from "./collector";

export interface Competitor {
  id: number;
  username: string;
  backfilled_at: string | null;
  last_scraped_at: string | null;
  is_curated: boolean;
  /** Distinct plans of the users tracking this account. */
  plans: string[];
  /** Tracked by this many users who rely on OUR collection. */
  platform_trackers: number;
  /** Tracking users who collect on their own key and whose key works. */
  key_owner_ids: string[];
}

/**
 * How often an account should be refreshed: as often as its best-paying
 * tracker's plan allows, so a free user's account is touched daily while a
 * Studio user's is every couple of hours. Featured accounts never go staler
 * than CURATED_REFRESH_HOURS. An account nobody tracks falls back to daily.
 */
export function refreshHoursFor(
  c: Pick<Competitor, "plans" | "is_curated">
): number {
  const hours = Math.min(
    ...c.plans.map((p) => planOf(p).refreshHours),
    c.is_curated ? CURATED_REFRESH_HOURS : Infinity
  );
  return Number.isFinite(hours) ? hours : planOf("free").refreshHours;
}

/** Whether an account is due a refresh at time `now` (ms). */
export function isDue(
  c: Pick<Competitor, "plans" | "is_curated" | "last_scraped_at">,
  now: number
): boolean {
  if (!c.last_scraped_at) return true;
  const SLACK_MS = 15 * 60_000; // cron jitter: do not skip a cycle by a minute
  return (
    now - new Date(c.last_scraped_at).getTime() >=
    refreshHoursFor(c) * 3_600_000 - SLACK_MS
  );
}

/**
 * Accounts worth collecting: ones somebody tracks, or that are featured in
 * Discover. An account nobody follows any more simply stops costing money.
 */
export async function loadCandidates(): Promise<Competitor[]> {
  return query<Competitor>(
    `
    SELECT c.id, c.username, c.backfilled_at, c.last_scraped_at, c.is_curated,
           COALESCE(
             ARRAY_AGG(DISTINCT CASE
                 WHEN u.is_admin THEN 'admin'
                 WHEN u.collector_key_enc IS NOT NULL AND u.plan = 'free'
                   THEN 'connect'
                 ELSE u.plan END)
               FILTER (WHERE u.id IS NOT NULL),
             '{}'
           ) AS plans,
           (COUNT(DISTINCT u.id)
              FILTER (WHERE u.collector_key_enc IS NULL))::int
             AS platform_trackers,
           COALESCE(
             ARRAY_AGG(DISTINCT u.id::text)
               FILTER (WHERE u.collector_key_enc IS NOT NULL
                         AND u.collector_status = 'ok'),
             '{}'
           ) AS key_owner_ids
    FROM competitors c
    LEFT JOIN user_competitors uc ON uc.competitor_id = c.id
    LEFT JOIN users u ON u.id = uc.user_id
    WHERE c.is_active AND (uc.user_id IS NOT NULL OR c.is_curated)
    GROUP BY c.id
    ORDER BY c.id
    `
  );
}

/**
 * Splits accounts by who pays for collecting them:
 *  - platform: featured accounts, and any account tracked by at least one user
 *    who relies on our collection (shared, so it is scraped once);
 *  - one pool per user with their own working key, for accounts ONLY they (and
 *    other self-funded users) track.
 * Accounts tracked only by users whose own key is broken or out of credit land
 * in no pool: they pause rather than quietly becoming our cost.
 */
export function splitPools(candidates: Competitor[]): {
  platform: Competitor[];
  byUser: Map<string, Competitor[]>;
} {
  const platform: Competitor[] = [];
  const byUser = new Map<string, Competitor[]>();

  for (const c of candidates) {
    if (c.is_curated || c.platform_trackers > 0) {
      platform.push(c);
      continue;
    }
    if (c.key_owner_ids.length === 0) continue;
    // Deterministic pick so an account is not scraped on several keys at once.
    const owner = [...c.key_owner_ids].sort((a, b) => Number(a) - Number(b))[0];
    byUser.set(owner, [...(byUser.get(owner) ?? []), c]);
  }
  return { platform, byUser };
}

export interface LaunchedRun {
  tier: Tier;
  runId: string;
  usernames: string[];
  estimatedCostUsd: number;
  /** null = collected on the platform's own key. */
  ownerUserId: number | null;
}

/** Who a run is billed to and which key starts it. */
interface Ctx {
  ownerUserId: number | null;
  token: string;
  /** Credit left on a user's key; null for the platform. */
  creditLeft: number | null;
}

function hookUrl(nonce: string): string {
  return `${config.baseUrl}/api/hooks/scrape?n=${encodeURIComponent(nonce)}`;
}

function estimate(count: number, limitPerProfile: number): number {
  const adapter = getAdapter();
  // Worst case: every profile returns a full page.
  return count * limitPerProfile * adapter.costPerPostUsd + adapter.startCostUsd;
}

class SkipPool extends Error {}

async function launch(
  tier: Tier,
  competitors: Competitor[],
  windowDays: number,
  limitPerProfile: number,
  ctx: Ctx
): Promise<LaunchedRun> {
  const usernames = competitors.map((c) => c.username);
  const estimatedCostUsd = estimate(usernames.length, limitPerProfile);

  // A user's run must fit in their remaining credit, otherwise it would die
  // half way and still bill them for what it fetched.
  if (ctx.creditLeft !== null && ctx.creditLeft < estimatedCostUsd) {
    if (ctx.ownerUserId !== null) await setStatus(ctx.ownerUserId, "out_of_credit");
    throw new SkipPool("not enough credit for this run");
  }

  // Single-use token for this run's completion callback. The URL is stored in
  // the collector account that runs it - for a user's own key, that is the
  // user's account - so it must authorise exactly one run and nothing else.
  const nonce = randomBytes(24).toString("base64url");
  const [row] = await query<{ id: number }>(
    `
    INSERT INTO scrape_runs (tier, usernames, status, owner_user_id, hook_nonce)
    VALUES ($1, $2, 'starting', $3, $4)
    RETURNING id
    `,
    [tier, usernames, ctx.ownerUserId, nonce]
  );

  let runId: string;
  try {
    const run = await startRun(
      {
        usernames,
        windowDays,
        limitPerProfile,
        webhookUrl: hookUrl(nonce),
      },
      ctx.token
    );
    runId = run.runId;
  } catch (err) {
    await query(
      `UPDATE scrape_runs SET status = 'failed', error = $2, finished_at = now() WHERE id = $1`,
      [row.id, err instanceof Error ? err.message : "run start failed"]
    );
    if (ctx.ownerUserId !== null && err instanceof CollectorHttpError) {
      if (err.status === 401) await setStatus(ctx.ownerUserId, "invalid");
      else if (err.status === 402 || err.status === 403) {
        await setStatus(ctx.ownerUserId, "out_of_credit");
      }
    }
    throw err;
  }

  await query(
    `UPDATE scrape_runs SET apify_run_id = $2, status = 'started' WHERE id = $1`,
    [row.id, runId]
  );

  if (ctx.creditLeft !== null) ctx.creditLeft -= estimatedCostUsd;
  return { tier, runId, usernames, estimatedCostUsd, ownerUserId: ctx.ownerUserId };
}

/** Last time a (non-failed) warm sweep started for this payer. */
async function lastWarmStart(ownerUserId: number | null): Promise<number | null> {
  const row = await queryOne<{ started_at: string }>(
    `
    SELECT started_at FROM scrape_runs
    WHERE tier = 'warm' AND status <> 'failed'
      AND owner_user_id IS NOT DISTINCT FROM $1::bigint
    ORDER BY started_at DESC LIMIT 1
    `,
    [ownerUserId]
  );
  return row ? new Date(row.started_at).getTime() : null;
}

/**
 * Runs the three tiers for one payer's pool:
 *   backfill - one deep fetch when an account is first added
 *   hot      - last couple of days, whenever the account is due (drives velocity)
 *   warm     - last month, roughly weekly (catches late bloomers)
 */
async function runPool(
  pool: Competitor[],
  ctx: Ctx,
  opts: { force?: Tier }
): Promise<LaunchedRun[]> {
  const launched: LaunchedRun[] = [];
  if (pool.length === 0) return launched;

  const now = Date.now();
  const needsBackfill = pool.filter((c) => !c.backfilled_at);
  const established = pool.filter((c) => c.backfilled_at);
  const dueNow = opts.force
    ? established
    : established.filter((c) => isDue(c, now));

  // New accounts get their history first; they'd show an empty feed otherwise.
  const backfillTargets =
    opts.force === "backfill" ? pool : needsBackfill;
  if (backfillTargets.length > 0) {
    launched.push(
      await launch(
        "backfill",
        backfillTargets,
        config.backfill.windowDays,
        config.backfill.limitPerProfile,
        ctx
      )
    );
    await query(
      `UPDATE competitors SET backfilled_at = now() WHERE id = ANY($1::int[])`,
      [backfillTargets.map((c) => c.id)]
    );
  }

  if (established.length === 0) return launched;

  if ((!opts.force || opts.force === "hot") && dueNow.length > 0) {
    launched.push(
      await launch(
        "hot",
        dueNow,
        config.hot.windowDays,
        config.hot.limitPerProfile,
        ctx
      )
    );
  }

  // Warm sweep is time-gated rather than every cycle.
  const lastWarm = await lastWarmStart(ctx.ownerUserId);
  const warmDue =
    lastWarm === null ||
    Date.now() - lastWarm > config.warm.everyHours * 3_600_000;

  if (warmDue || opts.force === "warm") {
    launched.push(
      await launch(
        "warm",
        established,
        config.warm.windowDays,
        config.warm.limitPerProfile,
        ctx
      )
    );
  }
  return launched;
}

/**
 * Re-checks keys that might have changed state since we last looked: ones that
 * ran out of credit (the monthly allowance may have renewed) and any not
 * checked for a day (the user may have revoked it).
 */
async function refreshCollectorStatuses(): Promise<void> {
  const rows = await query<{ id: string }>(
    `
    SELECT id FROM users
    WHERE collector_key_enc IS NOT NULL
      AND collector_status IS DISTINCT FROM 'invalid'
      AND (collector_status = 'out_of_credit'
           OR collector_checked_at IS NULL
           OR collector_checked_at < now() - interval '24 hours')
    ORDER BY collector_checked_at NULLS FIRST
    LIMIT 50
    `
  );
  for (const r of rows) {
    const userId = Number(r.id);
    const token = await getUserToken(userId);
    if (!token) {
      await setStatus(userId, "invalid");
      continue;
    }
    await saveCheck(userId, await checkToken(token));
  }
}

/**
 * Decides what to collect this cycle and fires the runs. Returns as soon as the
 * runs are *queued* - results arrive later via the callback.
 *
 * Each payer is handled separately: the platform's key for shared/featured
 * accounts, and each self-funded user's own key for the accounts only they
 * track. One user's broken key or empty credit never stops anyone else's.
 */
export async function runPollCycle(
  opts: { force?: Tier } = {}
): Promise<LaunchedRun[]> {
  const launched: LaunchedRun[] = [];

  await refreshCollectorStatuses().catch((e) =>
    console.error("collector status refresh failed:", e instanceof Error ? e.message : e)
  );

  const candidates = await loadCandidates();
  if (candidates.length === 0) return launched;
  const { platform, byUser } = splitPools(candidates);

  // ---- platform pool ----
  try {
    launched.push(
      ...(await runPool(
        platform,
        { ownerUserId: null, token: config.apify.token, creditLeft: null },
        opts
      ))
    );
  } catch (err) {
    if (!(err instanceof SkipPool)) {
      console.error("platform collection failed:", err instanceof Error ? err.message : err);
    }
  }

  // ---- one pool per self-funded user ----
  for (const [ownerId, pool] of byUser) {
    const userId = Number(ownerId);
    try {
      const token = await getUserToken(userId);
      if (!token) {
        await setStatus(userId, "invalid");
        continue;
      }

      const check = await checkToken(token);
      if (check.state === "unreachable") continue; // try again next cycle
      await saveCheck(userId, check);
      if (check.state !== "ok") continue;

      launched.push(
        ...(await runPool(
          pool,
          { ownerUserId: userId, token, creditLeft: check.creditLeftUsd },
          // A manual "force" must never spend a user's credit.
          {}
        ))
      );
    } catch (err) {
      if (!(err instanceof SkipPool)) {
        console.error(
          `collection for user ${userId} failed:`,
          err instanceof Error ? err.message : err
        );
      }
    }
  }

  return launched;
}
