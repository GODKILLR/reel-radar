/**
 * Runs a full poll cycle locally, start to finish, without needing a public URL.
 *
 * In production the flow is cron -> Apify -> webhook -> ingest, because a
 * serverless function cannot sit and wait for a scrape. Locally Apify has no
 * way to call back to localhost, so this script does the webhook's half of the
 * work itself: start the run, wait for it, pull the dataset, ingest.
 *
 * Usage:
 *   npm run poll:local                  # hot tier over all active accounts
 *   npm run poll:local -- backfill      # one-time history fetch
 *   npm run poll:local -- hot 5         # cap posts per profile (cost control)
 */
import { query, queryOne } from "../src/lib/db";
import { config, assertConfigured } from "../src/lib/config";
import {
  startRun,
  waitForRun,
  fetchDatasetItems,
  getRunCost,
  normalizePost,
  type Tier,
} from "../src/lib/apify";
import { getAdapter } from "../src/lib/actors";
import { ingestPosts } from "../src/lib/ingest";
import { dispatchOutlierAlerts } from "../src/lib/alerts";

const tier = (process.argv[2] as Tier) || "hot";
const limitOverride = process.argv[3] ? Number(process.argv[3]) : null;

const WINDOWS: Record<Tier, { windowDays: number; limitPerProfile: number }> = {
  hot: {
    windowDays: config.hot.windowDays,
    limitPerProfile: config.hot.limitPerProfile,
  },
  warm: {
    windowDays: config.warm.windowDays,
    limitPerProfile: config.warm.limitPerProfile,
  },
  backfill: {
    windowDays: config.backfill.windowDays,
    limitPerProfile: config.backfill.limitPerProfile,
  },
};

async function main() {
  assertConfigured();

  if (!WINDOWS[tier]) {
    throw new Error(`Unknown tier "${tier}". Use hot, warm, or backfill.`);
  }

  const accounts = await query<{ id: number; username: string }>(
    `SELECT id, username FROM competitors WHERE is_active ORDER BY username`
  );
  if (accounts.length === 0) {
    console.log("No active competitors. Add some first.");
    return;
  }

  const { windowDays } = WINDOWS[tier];
  const limitPerProfile = limitOverride ?? WINDOWS[tier].limitPerProfile;
  const usernames = accounts.map((a) => a.username);

  const adapter = getAdapter();
  const worstCase =
    usernames.length * limitPerProfile * adapter.costPerPostUsd +
    adapter.startCostUsd;
  console.log(`actor: ${adapter.label} ($${adapter.costPerPostUsd}/post)`);
  console.log(
    `${tier}: ${usernames.length} account(s), last ${windowDays}d, ` +
      `<=${limitPerProfile} posts each`
  );
  console.log(`  accounts: ${usernames.join(", ")}`);
  console.log(`  worst-case cost: $${worstCase.toFixed(4)}`);

  const run = await startRun({ usernames, windowDays, limitPerProfile });
  console.log(`  started run ${run.runId} -- waiting...`);

  await query(
    `INSERT INTO scrape_runs (apify_run_id, tier, usernames, status)
     VALUES ($1, $2, $3, 'started')`,
    [run.runId, tier, usernames]
  );

  const finished = await waitForRun(run.runId);
  console.log(`  run finished: ${finished.status}`);

  if (finished.status !== "SUCCEEDED") {
    await query(
      `UPDATE scrape_runs SET status='failed', error=$2, finished_at=now()
       WHERE apify_run_id=$1`,
      [run.runId, finished.status]
    );
    throw new Error(`Run ended as ${finished.status}`);
  }

  const raw = await fetchDatasetItems(
    finished.defaultDatasetId || run.datasetId
  );
  console.log(`  dataset items: ${raw.length}`);

  const normalized = raw
    .map((item) => normalizePost(item))
    .filter((p): p is NonNullable<typeof p> => p !== null);
  const dropped = raw.length - normalized.length;
  if (dropped > 0) console.log(`  dropped ${dropped} unparseable item(s)`);

  const result = await ingestPosts(normalized);
  const alerts = await dispatchOutlierAlerts({ silent: tier === "backfill" });

  // Apify's own billing figure, not an estimate.
  const actualCost = (await getRunCost(run.runId)) ?? 0;
  await query(
    `UPDATE scrape_runs SET status='succeeded', posts_seen=$2, posts_new=$3,
            cost_usd=$4, finished_at=now()
     WHERE apify_run_id=$1`,
    [run.runId, result.seen, result.inserted, actualCost]
  );

  if (tier === "backfill") {
    await query(
      `UPDATE competitors SET backfilled_at = now()
       WHERE username = ANY($1::text[])`,
      [usernames]
    );
  }

  console.log(
    `\n  ingested ${result.seen} (${result.inserted} new, ${result.updated} updated)`
  );
  if (result.skippedUnknownAccount.length) {
    console.log(`  skipped unknown: ${result.skippedUnknownAccount.join(", ")}`);
  }
  console.log(
    `  outliers claimed: ${alerts.claimed}, notifications sent: ${alerts.notified}`
  );
  console.log(`  actual billed cost: $${actualCost.toFixed(4)}`);

  const spend = await queryOne<{ last_30d: string }>(
    `SELECT COALESCE(SUM(cost_usd),0)::text AS last_30d FROM scrape_runs
     WHERE status='succeeded' AND started_at > now() - interval '30 days'`
  );
  console.log(`  rolling 30d spend: $${Number(spend!.last_30d).toFixed(4)}`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("\nPoll failed:", err instanceof Error ? err.message : err);
    process.exit(1);
  });
