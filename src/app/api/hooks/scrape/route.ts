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
import { checkToken, getUserToken, saveCheck, setStatus } from "@/lib/collector";
import { runForUser, runPlatformNow } from "@/lib/poller";
import { accountsWithoutViews } from "@/lib/views";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

interface CollectorWebhookBody {
  eventType?: string;
  eventData?: { actorRunId?: string };
  resource?: {
    id?: string;
    status?: string;
    defaultDatasetId?: string;
  };
}

interface RunRow {
  id: number;
  apify_run_id: string | null;
  tier: string;
  usernames: string[] | null;
  owner_user_id: string | null;
  status: string;
  /** Which collector produced this run's data (null = the default one). */
  adapter: string | null;
}

/**
 * Called by the collector when a run finishes. This is where the actual work
 * happens: pull the dataset, upsert posts, snapshot metrics, recompute
 * outliers, alert.
 *
 * Authorisation is a single-use token minted for exactly this run (`?n=`), not
 * a global secret: for a run on a user's own key the callback URL lives in
 * that user's collector account, where they can read it.
 */
export async function POST(req: NextRequest) {
  const nonce = new URL(req.url).searchParams.get("n") ?? "";
  if (nonce.length < 16) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const run = await queryOne<RunRow>(
    `
    SELECT id, apify_run_id, tier, usernames, owner_user_id::text AS owner_user_id,
           status, adapter
    FROM scrape_runs WHERE hook_nonce = $1
    `,
    [nonce]
  );
  if (!run) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  let body: CollectorWebhookBody;
  try {
    body = (await req.json()) as CollectorWebhookBody;
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }

  const runId = body.resource?.id ?? body.eventData?.actorRunId;
  if (!runId) {
    return NextResponse.json({ error: "missing run id" }, { status: 400 });
  }

  // The token authorises one specific run. Anything else is a replay.
  if (run.apify_run_id && run.apify_run_id !== runId) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  if (!run.apify_run_id) {
    // The callback beat our own bookkeeping: record the id now.
    await query(`UPDATE scrape_runs SET apify_run_id = $2 WHERE id = $1`, [
      run.id,
      runId,
    ]);
  }

  // Collectors retry callbacks; a finished run must not be ingested twice.
  if (run.status === "succeeded") {
    return NextResponse.json({ ok: true, duplicate: true });
  }

  const ownerId = run.owner_user_id ? Number(run.owner_user_id) : null;
  const token =
    ownerId === null ? config.apify.token : await getUserToken(ownerId);

  const succeeded =
    body.eventType === "ACTOR.RUN.SUCCEEDED" ||
    body.resource?.status === "SUCCEEDED";

  /** Marks the run failed and undoes the "history fetched" marker if needed. */
  const fail = async (reason: string) => {
    await query(
      `UPDATE scrape_runs SET status = 'failed', error = $2, finished_at = now() WHERE id = $1`,
      [run.id, reason]
    );
    // A backfill is marked done at launch so it cannot fire twice. If it never
    // landed, clear the marker so the next cycle retries instead of leaving the
    // account permanently without history.
    if (run.tier === "backfill" && run.usernames?.length) {
      await query(
        `UPDATE competitors SET backfilled_at = NULL WHERE username = ANY($1::text[])`,
        [run.usernames]
      );
    }
  };

  if (!succeeded) {
    await fail(body.eventType ?? body.resource?.status ?? "unknown failure");

    // A user's run most often fails because their credit ran out or the key
    // was revoked: find out which, so they see an honest status.
    if (ownerId !== null && token) {
      await saveCheck(ownerId, await checkToken(token)).catch(() => {});
    }
    // 200 so the collector does not retry a run that will never succeed.
    return NextResponse.json({ ok: true, recorded: "failure" });
  }

  if (!token) {
    // The user disconnected their key while the run was in flight.
    if (ownerId !== null) await setStatus(ownerId, "invalid").catch(() => {});
    await fail("key unavailable");
    return NextResponse.json({ ok: true, recorded: "key unavailable" });
  }

  try {
    const datasetId =
      body.resource?.defaultDatasetId ?? (await getRunDataset(runId, token));

    const raw = await fetchDatasetItems(datasetId, token);
    const wanted = new Set((run.usernames ?? []).map((u) => u.toLowerCase()));
    const normalized = raw
      // Each item is read with the collector that produced it (stored on the
      // run), never by passing normalizePost straight to map().
      .map((item) => normalizePost(item, run.adapter))
      .filter((p): p is NonNullable<typeof p> => p !== null)
      // Only accept posts for accounts this run was actually asked to collect.
      .filter((p) => wanted.size === 0 || wanted.has(p.username.toLowerCase()));

    const result = await ingestPosts(normalized);

    // Mark every account this run covered as collected, even one that returned
    // nothing (private, empty). Without this it would look "never collected"
    // and be fetched again and again on the user's credit.
    if (run.usernames && run.usernames.length > 0) {
      await query(
        `UPDATE competitors SET last_scraped_at = now() WHERE username = ANY($1::text[])`,
        [run.usernames]
      );
    }

    // A backfill drags in an account's whole history at once, so every past
    // hit crosses the threshold simultaneously. Claim those silently and only
    // notify on outliers discovered by later polls.
    const alerted = await dispatchOutlierAlerts({
      silent: run.tier === "backfill",
    });

    // Read the real figure from the collector's billing rather than
    // multiplying out an assumed per-post rate.
    const billedUsd = await getRunCost(runId, token);
    await query(
      `
      UPDATE scrape_runs SET
        status      = 'succeeded',
        posts_seen  = $2,
        posts_new   = $3,
        cost_usd    = $4,
        finished_at = now()
      WHERE id = $1
      `,
      [run.id, result.seen, result.inserted, billedUsd ?? 0]
    );

    // Keep a user's "credit left" meter honest after every run.
    if (ownerId !== null) {
      await saveCheck(ownerId, await checkToken(token)).catch(() => {});
    }

    // Some accounts' reels come back from the cheap collector with no view
    // counts at all. Move such an account to the fuller collector and collect
    // it again straight away, on the same key, so the views fill in without the
    // user doing anything. (Runs already on the fuller collector are not
    // second-guessed, so this can never loop.)
    let recollecting: string[] = [];
    if (!run.adapter) {
      const missing = accountsWithoutViews(normalized);
      if (missing.length > 0) {
        const switched = await query<{ username: string }>(
          `
          UPDATE competitors
          SET views_source = 'official', backfilled_at = NULL, last_scraped_at = NULL
          WHERE username = ANY($1::text[]) AND views_source IS NULL
          RETURNING username
          `,
          [missing]
        );
        recollecting = switched.map((s) => s.username);
        if (recollecting.length > 0) {
          // Whatever like counts the cheap collector gave for these accounts
          // are not trustworthy (it reports a small placeholder when likes are
          // hidden), and counters are never allowed to go down on update, so
          // clear them and let the fuller collector's figures win.
          await query(
            `
            UPDATE posts SET likes = 0
            WHERE competitor_id IN (SELECT id FROM competitors WHERE username = ANY($1::text[]))
            `,
            [recollecting]
          );
          try {
            if (ownerId !== null) await runForUser(ownerId);
            else await runPlatformNow();
          } catch (err) {
            // Best effort: the account is already marked, so the next request
            // from the user (or the scheduler) collects it.
            console.error("re-collect failed:", err instanceof Error ? err.message : err);
          }
        }
      }
    }

    return NextResponse.json({
      ok: true,
      recollecting,
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
    console.error("hook ingest failed:", message);
    await fail(message);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
