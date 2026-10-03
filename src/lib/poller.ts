import { query, queryOne } from "./db";
import { config } from "./config";
import { startRun, type Tier } from "./apify";
import { getAdapter } from "./actors";

interface Competitor {
  id: number;
  username: string;
  backfilled_at: string | null;
}

export interface LaunchedRun {
  tier: Tier;
  runId: string;
  usernames: string[];
  estimatedCostUsd: number;
}

function webhookUrl(): string {
  const secret = encodeURIComponent(config.secrets.webhook);
  return `${config.baseUrl}/api/webhooks/apify?secret=${secret}`;
}

async function launch(
  tier: Tier,
  competitors: Competitor[],
  windowDays: number,
  limitPerProfile: number
): Promise<LaunchedRun> {
  const usernames = competitors.map((c) => c.username);

  const run = await startRun({
    usernames,
    windowDays,
    limitPerProfile,
    webhookUrl: webhookUrl(),
  });

  // Worst case: every profile returns a full page. The real figure is read
  // back from Apify's own billing when the webhook lands.
  const adapter = getAdapter();
  const estimatedCostUsd =
    usernames.length * limitPerProfile * adapter.costPerPostUsd +
    adapter.startCostUsd;

  await query(
    `
    INSERT INTO scrape_runs (apify_run_id, tier, usernames, status)
    VALUES ($1, $2, $3, 'started')
    `,
    [run.runId, tier, usernames]
  );

  return { tier, runId: run.runId, usernames, estimatedCostUsd };
}

/**
 * Decides what to scrape this cycle and fires the Apify runs. Returns as soon
 * as the runs are *queued* — results arrive later via the webhook.
 *
 * Three tiers, so that a 2-hour cadence does not mean re-paying for a
 * competitor's entire back catalogue twelve times a day:
 *   backfill - one deep fetch when an account is first added
 *   hot      - last couple of days, every cycle (drives velocity)
 *   warm     - last month, roughly daily (catches late bloomers)
 */
export async function runPollCycle(
  opts: { force?: Tier } = {}
): Promise<LaunchedRun[]> {
  const launched: LaunchedRun[] = [];

  const active = await query<Competitor>(
    `
    SELECT id, username, backfilled_at
    FROM competitors
    WHERE is_active
    ORDER BY id
    `
  );
  if (active.length === 0) return launched;

  const needsBackfill = active.filter((c) => !c.backfilled_at);
  const established = active.filter((c) => c.backfilled_at);

  // New accounts get their history first; they'd show an empty feed otherwise.
  if (needsBackfill.length > 0 || opts.force === "backfill") {
    const targets = opts.force === "backfill" ? active : needsBackfill;
    if (targets.length > 0) {
      launched.push(
        await launch(
          "backfill",
          targets,
          config.backfill.windowDays,
          config.backfill.limitPerProfile
        )
      );
      await query(
        `UPDATE competitors SET backfilled_at = now() WHERE id = ANY($1::int[])`,
        [targets.map((c) => c.id)]
      );
    }
  }

  if (established.length === 0) return launched;

  if (!opts.force || opts.force === "hot") {
    launched.push(
      await launch(
        "hot",
        established,
        config.hot.windowDays,
        config.hot.limitPerProfile
      )
    );
  }

  // Warm sweep is time-gated rather than every cycle.
  const lastWarm = await queryOne<{ started_at: string }>(
    `
    SELECT started_at FROM scrape_runs
    WHERE tier = 'warm' AND status <> 'failed'
    ORDER BY started_at DESC LIMIT 1
    `
  );
  const warmDue =
    !lastWarm ||
    Date.now() - new Date(lastWarm.started_at).getTime() >
      config.warm.everyHours * 3_600_000;

  if (warmDue || opts.force === "warm") {
    launched.push(
      await launch(
        "warm",
        established,
        config.warm.windowDays,
        config.warm.limitPerProfile
      )
    );
  }

  return launched;
}
