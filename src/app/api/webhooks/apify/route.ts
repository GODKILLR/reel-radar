import { NextResponse, type NextRequest } from "next/server";
import { config } from "@/lib/config";
import { query, queryOne } from "@/lib/db";
import {
  fetchDatasetItems,
  getRunCost,
  getRunDataset,
  normalizePost,
} from "@/lib/apify";
import { ingestPosts } from "@/lib/ingest";
import { dispatchOutlierAlerts } from "@/lib/alerts";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

interface ApifyWebhookBody {
  eventType?: string;
  eventData?: { actorRunId?: string };
  resource?: {
    id?: string;
    status?: string;
    defaultDatasetId?: string;
  };
}

/**
 * Called by Apify when a run finishes. This is where the actual work happens:
 * pull the dataset, upsert posts, snapshot metrics, recompute outliers, alert.
 */
export async function POST(req: NextRequest) {
  const secret = new URL(req.url).searchParams.get("secret") ?? "";
  if (!config.secrets.webhook || secret !== config.secrets.webhook) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  let body: ApifyWebhookBody;
  try {
    body = (await req.json()) as ApifyWebhookBody;
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }

  const runId = body.resource?.id ?? body.eventData?.actorRunId;
  if (!runId) {
    return NextResponse.json({ error: "missing run id" }, { status: 400 });
  }

  const succeeded =
    body.eventType === "ACTOR.RUN.SUCCEEDED" ||
    body.resource?.status === "SUCCEEDED";

  if (!succeeded) {
    const failed = await queryOne<{ tier: string; usernames: string[] }>(
      `
      UPDATE scrape_runs
      SET status = 'failed', error = $2, finished_at = now()
      WHERE apify_run_id = $1
      RETURNING tier, usernames
      `,
      [runId, body.eventType ?? body.resource?.status ?? "unknown failure"]
    );

    // A backfill is marked done at launch so it cannot fire twice. If it never
    // landed, clear the marker so the next cycle retries instead of leaving the
    // account permanently without history.
    if (failed?.tier === "backfill" && failed.usernames?.length) {
      await query(
        `
        UPDATE competitors SET backfilled_at = NULL
        WHERE username = ANY($1::text[])
        `,
        [failed.usernames]
      );
    }

    // 200 so Apify does not retry a run that will never succeed.
    return NextResponse.json({ ok: true, recorded: "failure" });
  }

  try {
    const datasetId =
      body.resource?.defaultDatasetId ?? (await getRunDataset(runId));

    const raw = await fetchDatasetItems(datasetId);
    const normalized = raw
      .map(normalizePost)
      .filter((p): p is NonNullable<typeof p> => p !== null);

    const result = await ingestPosts(normalized);

    // A backfill drags in an account's whole history at once, so every past
    // hit crosses the threshold simultaneously. Claim those silently and only
    // notify on outliers discovered by later polls.
    const run = await queryOne<{ tier: string }>(
      `SELECT tier FROM scrape_runs WHERE apify_run_id = $1`,
      [runId]
    );
    const alerted = await dispatchOutlierAlerts({
      silent: run?.tier === "backfill",
    });

    // Read the real figure straight from Apify's billing rather than
    // multiplying out an assumed per-post rate.
    const billedUsd = await getRunCost(runId);
    await query(
      `
      UPDATE scrape_runs SET
        status      = 'succeeded',
        posts_seen  = $2,
        posts_new   = $3,
        cost_usd    = $4,
        finished_at = now()
      WHERE apify_run_id = $1
      `,
      [runId, result.seen, result.inserted, billedUsd ?? 0]
    );

    return NextResponse.json({
      ok: true,
      rawItems: raw.length,
      ingested: result.seen,
      newPosts: result.inserted,
      updatedPosts: result.updated,
      skippedUnknownAccount: result.skippedUnknownAccount,
      outliersClaimed: alerted.claimed,
      alertsSent: alerted.notified,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("webhook ingest failed:", message);
    await query(
      `
      UPDATE scrape_runs
      SET status = 'failed', error = $2, finished_at = now()
      WHERE apify_run_id = $1
      `,
      [runId, message]
    );
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
