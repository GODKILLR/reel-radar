import { randomBytes } from "node:crypto";
import { query, queryOne } from "./db";
import { config } from "./config";
import { startRun, CollectorHttpError, type Tier } from "./apify";
import { getAdapter } from "./actors";
import { CURATED_REFRESH_HOURS, REFRESH_HOURS } from "./plans";
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
  /** null = default collector; 'official' = the one that reports views for it. */
  views_source: string | null;
  /** Tracked by this many admins, whose collection we run ourselves. */
  platform_trackers: number;
  /** Tracking users who collect on their own key and whose key works. */
  key_owner_ids: string[];
}

/**
 * How often an account should be refreshed: daily for everyone (it is the
 * user's own credit being spent), and featured accounts never go staler than
 * CURATED_REFRESH_HOURS.
 */
export function refreshHoursFor(c: Pick<Competitor, "is_curated">): number {
  return c.is_curated ? CURATED_REFRESH_HOURS : REFRESH_HOURS;
}

/** Whether an account is due a refresh at time `now` (ms). */
export function isDue(
  c: Pick<Competitor, "is_curated" | "last_scraped_at">,
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
           c.views_source,
           (COUNT(DISTINCT u.id)
              FILTER (WHERE u.is_admin AND u.collector_key_enc IS NULL))::int
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
 *  - platform: featured accounts, and any account an admin tracks (we run
 *    those ourselves, shared so each is scraped once);
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

function estimate(
  count: number,
  limitPerProfile: number,
  adapterKey?: string
): number {
  const adapter = getAdapter(adapterKey);
  // Worst case: every profile returns a full page.
  return count * limitPerProfile * adapter.costPerPostUsd + adapter.startCostUsd;
}

class SkipPool extends Error {}

/**
 * Accounts are collected with the cheap default collector unless it is known
 * not to report views for them, in which case they use the fuller one. One
 * tier may therefore become two runs.
 */
function groupByCollector(list: Competitor[]): { key?: string; list: Competitor[] }[] {
  const full = list.filter((c) => c.views_source === "official");
  const cheap = list.filter((c) => c.views_source !== "official");
  return [
    ...(cheap.length ? [{ list: cheap }] : []),
    ...(full.length ? [{ key: "official", list: full }] : []),
  ];
}

async function launch(
  tier: Tier,
  competitors: Competitor[],
  windowDays: number,
  limitPerProfile: number,
  ctx: Ctx,
  adapterKey?: string
): Promise<LaunchedRun> {
  const usernames = competitors.map((c) => c.username);
  const estimatedCostUsd = estimate(usernames.length, limitPerProfile, adapterKey);

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
    INSERT INTO scrape_runs (tier, usernames, status, owner_user_id, hook_nonce, adapter)
    VALUES ($1, $2, 'starting', $3, $4, $5)
    RETURNING id
    `,
    [tier, usernames, ctx.ownerUserId, nonce, adapterKey ?? null]
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
      ctx.token,
      adapterKey
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

/** How long a first collection may stay unanswered before we try again. */
const BACKFILL_TIMEOUT_MS = 30 * 60_000;

/**
 * Where an account is in its life:
 *  - new:         never collected (or its first collection got lost): needs history
 *  - pending:     history fetch is in flight right now - hands off, nobody else
 *                 may start a refresh or sweep for it yet
 *  - established: has data; refreshed on schedule
 */
export function accountPhase(
  c: Pick<Competitor, "backfilled_at" | "last_scraped_at">,
  now: number
): "new" | "pending" | "established" {
  if (c.last_scraped_at) return "established";
  if (!c.backfilled_at) return "new";
  return now - new Date(c.backfilled_at).getTime() > BACKFILL_TIMEOUT_MS
    ? "new"
    : "pending";
}

/** History was fetched less than a day ago, so a deeper sweep would add nothing. */
export function recentlyBackfilled(
  c: Pick<Competitor, "backfilled_at">,
  now: number
): boolean {
  return (
    !!c.backfilled_at &&
    now - new Date(c.backfilled_at).getTime() < 24 * 3_600_000
  );
}

/** Atomically marks accounts as "history fetch in progress"; returns the ones WE got. */
async function claimBackfill(ids: number[]): Promise<number[]> {
  const rows = await query<{ id: number }>(
    `
    UPDATE competitors SET backfilled_at = now()
    WHERE id = ANY($1::int[])
      AND (backfilled_at IS NULL
           OR (last_scraped_at IS NULL
               AND backfilled_at < now() - interval '30 minutes'))
    RETURNING id
    `,
    [ids]
  );
  return rows.map((r) => r.id);
}

async function unclaimBackfill(ids: number[]): Promise<void> {
  await query(
    `UPDATE competitors SET backfilled_at = NULL WHERE id = ANY($1::int[])`,
    [ids]
  );
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
  opts: {
    force?: Tier;
    /** Refresh every established account now, not just the ones that are due. */
    forceHot?: boolean;
    /** Skip the refresh tier (used to throttle repeated manual refreshes). */
    skipHot?: boolean;
  }
): Promise<LaunchedRun[]> {
  const launched: LaunchedRun[] = [];
  if (pool.length === 0) return launched;

  const now = Date.now();
  const needsBackfill = pool.filter((c) => accountPhase(c, now) === "new");
  const established = pool.filter((c) => accountPhase(c, now) === "established");
  const dueNow = opts.skipHot
    ? []
    : opts.force || opts.forceHot
      ? established
      : established.filter((c) => isDue(c, now));

  // New accounts get their history first; they'd show an empty feed otherwise.
  const backfillTargets =
    opts.force === "backfill" ? pool : needsBackfill;
  if (backfillTargets.length > 0) {
    // Claim the accounts atomically BEFORE launching. Two things can ask for
    // the same new account at once (the user's own request and the scheduler,
    // or two users tracking it), and only one of them may pay for its history.
    // A forced re-backfill deliberately skips the claim.
    const ids = backfillTargets.map((c) => c.id);
    const claimed =
      opts.force === "backfill" ? ids : await claimBackfill(ids);
    const targets = backfillTargets.filter((c) => claimed.includes(c.id));
    for (const group of groupByCollector(targets)) {
      try {
        launched.push(
          await launch(
            "backfill",
            group.list,
            config.backfill.windowDays,
            config.backfill.limitPerProfile,
            ctx,
            group.key
          )
        );
      } catch (err) {
        // The run never started: hand the accounts back so they retry later.
        if (opts.force !== "backfill") await unclaimBackfill(group.list.map((c) => c.id));
        throw err;
      }
    }
  }

  if (established.length === 0) return launched;

  if ((!opts.force || opts.force === "hot") && dueNow.length > 0) {
    for (const group of groupByCollector(dueNow)) {
      launched.push(
        await launch(
          "hot",
          group.list,
          config.hot.windowDays,
          config.hot.limitPerProfile,
          ctx,
          group.key
        )
      );
    }
  }

  // Warm sweep is time-gated rather than every cycle, and skips accounts whose
  // history was fetched less than a day ago: sweeping them straight after a
  // 200-post history fetch would just pay for the same posts twice.
  const sweepable = established.filter((c) => !recentlyBackfilled(c, now));
  const lastWarm = await lastWarmStart(ctx.ownerUserId);
  const warmDue =
    lastWarm === null ||
    Date.now() - lastWarm > config.warm.everyHours * 3_600_000;

  if ((warmDue || opts.force === "warm") && sweepable.length > 0) {
    for (const group of groupByCollector(sweepable)) {
      launched.push(
        await launch(
          "warm",
          group.list,
          config.warm.windowDays,
          config.warm.limitPerProfile,
          ctx,
          group.key
        )
      );
    }
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

// ---------------------------------------------------------------------------
// Collection on request. The scheduler is a safety net, not the engine: when a
// user adds an account, opens the app, or presses "Refresh now", their own
// accounts are collected right away on their own key.
// ---------------------------------------------------------------------------

/** Minimum gap between two *refreshes* for one user (new accounts are exempt). */
const REFRESH_COOLDOWN_MINUTES = 15;

export type CollectOutcome =
  | "started" // at least one run was queued
  | "nothing_due" // everything is already fresh
  | "in_progress" // a collection for this user is already running
  | "cooldown" // refreshed a moment ago
  | "no_key" // no key connected
  | "invalid" // the key no longer works
  | "out_of_credit" // the key has no credit left this month
  | "unreachable"; // could not reach the collector; try again

export interface CollectResult {
  outcome: CollectOutcome;
  /** What was queued, by tier. */
  launched: { tier: Tier; accounts: number }[];
}

/**
 * The accounts that THIS user's key is responsible for: theirs, minus the ones
 * we collect ourselves (featured accounts and admins' accounts).
 */
async function loadUserPool(userId: number): Promise<Competitor[]> {
  return query<Competitor>(
    `
    SELECT c.id, c.username, c.backfilled_at, c.last_scraped_at, c.is_curated,
           c.views_source,
           (SELECT COUNT(*)::int
              FROM user_competitors uc2 JOIN users u2 ON u2.id = uc2.user_id
             WHERE uc2.competitor_id = c.id
               AND u2.is_admin AND u2.collector_key_enc IS NULL)
             AS platform_trackers,
           '{}'::text[] AS key_owner_ids
    FROM user_competitors uc
    JOIN competitors c ON c.id = uc.competitor_id
    WHERE uc.user_id = $1 AND c.is_active
    ORDER BY c.id
    `,
    [userId]
  ).then((rows) => rows.filter((c) => !c.is_curated && c.platform_trackers === 0));
}

/** A run for this user was queued recently and has not reported back yet. */
async function runInProgress(userId: number): Promise<boolean> {
  const row = await queryOne(
    `
    SELECT 1 FROM scrape_runs
    WHERE owner_user_id = $1 AND status IN ('starting', 'started')
      AND started_at > now() - interval '30 minutes'
    LIMIT 1
    `,
    [userId]
  );
  return row !== null;
}

async function ranRecently(userId: number, minutes: number): Promise<boolean> {
  const row = await queryOne(
    `
    SELECT 1 FROM scrape_runs
    WHERE owner_user_id = $1 AND status <> 'failed'
      AND started_at > now() - ($2::int * interval '1 minute')
    LIMIT 1
    `,
    [userId, minutes]
  );
  return row !== null;
}

/**
 * Collects whatever this user's accounts need, on their own key:
 *  - new accounts: their history, immediately, every time;
 *  - existing accounts: a refresh if they are due (or `force`), at most once
 *    per cooldown;
 *  - a weekly deeper sweep.
 * Cheap to call repeatedly: when nothing is due it answers without touching the
 * collector at all.
 */
export async function runForUser(
  userId: number,
  opts: { force?: boolean } = {}
): Promise<CollectResult> {
  const pool = await loadUserPool(userId);
  const none: CollectResult = { outcome: "nothing_due", launched: [] };
  if (pool.length === 0) return none;

  const now = Date.now();
  const needsBackfill = pool.filter((c) => accountPhase(c, now) === "new");
  const established = pool.filter((c) => accountPhase(c, now) === "established");

  const cooling = established.length > 0 && (await ranRecently(userId, REFRESH_COOLDOWN_MINUTES));
  const refreshDue = opts.force
    ? established.length > 0
    : established.some((c) => isDue(c, now));
  const hotWanted = refreshDue && !cooling;

  const lastWarm = await lastWarmStart(userId);
  const warmWanted =
    established.some((c) => !recentlyBackfilled(c, now)) &&
    (lastWarm === null ||
      now - lastWarm > config.warm.everyHours * 3_600_000) &&
    !cooling;

  if (needsBackfill.length === 0 && !hotWanted && !warmWanted) {
    if (await runInProgress(userId)) return { outcome: "in_progress", launched: [] };
    return { outcome: cooling && refreshDue ? "cooldown" : "nothing_due", launched: [] };
  }

  // Something needs collecting: only now do we touch the user's key.
  const token = await getUserToken(userId);
  if (!token) {
    const row = await queryOne<{ has: boolean }>(
      `SELECT (collector_key_enc IS NOT NULL) AS has FROM users WHERE id = $1`,
      [userId]
    );
    if (row?.has) await setStatus(userId, "invalid");
    return { outcome: row?.has ? "invalid" : "no_key", launched: [] };
  }

  const check = await checkToken(token);
  if (check.state === "unreachable") return { outcome: "unreachable", launched: [] };
  await saveCheck(userId, check);
  if (check.state === "invalid") return { outcome: "invalid", launched: [] };
  if (check.state === "out_of_credit") return { outcome: "out_of_credit", launched: [] };

  const ctx: Ctx = { ownerUserId: userId, token, creditLeft: check.creditLeftUsd };
  try {
    const runs = await runPool(pool, ctx, {
      forceHot: !!opts.force,
      skipHot: !hotWanted,
    });
    return {
      outcome: runs.length > 0 ? "started" : "nothing_due",
      launched: runs.map((r) => ({ tier: r.tier, accounts: r.usernames.length })),
    };
  } catch (err) {
    if (err instanceof SkipPool) return { outcome: "out_of_credit", launched: [] };
    if (err instanceof CollectorHttpError) {
      if (err.status === 401) return { outcome: "invalid", launched: [] };
      if (err.status === 402 || err.status === 403) return { outcome: "out_of_credit", launched: [] };
    }
    throw err;
  }
}

/** Collects the platform's own accounts (featured + admins') right now. */
export async function runPlatformNow(): Promise<LaunchedRun[]> {
  const { platform } = splitPools(await loadCandidates());
  try {
    return await runPool(
      platform,
      { ownerUserId: null, token: config.apify.token, creditLeft: null },
      {}
    );
  } catch (err) {
    if (err instanceof SkipPool) return [];
    throw err;
  }
}
