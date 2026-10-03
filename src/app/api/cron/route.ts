import { NextResponse, type NextRequest } from "next/server";
import { config, assertConfigured } from "@/lib/config";
import { runPollCycle } from "@/lib/poller";
import type { Tier } from "@/lib/apify";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * The scheduled entry point. Deliberately does no scraping itself: it queues
 * Apify runs and returns in well under a second, which keeps it compatible
 * with any cron provider's timeout.
 *
 * Auth accepts either an `Authorization: Bearer <CRON_SECRET>` header (what
 * Vercel Cron sends) or `?secret=` (what external cron services can send).
 */
async function handle(req: NextRequest) {
  const url = new URL(req.url);
  const provided =
    req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ??
    url.searchParams.get("secret") ??
    "";

  if (!config.secrets.cron || provided !== config.secrets.cron) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  try {
    assertConfigured();
    const force = url.searchParams.get("tier") as Tier | null;
    const launched = await runPollCycle(
      force ? { force } : {}
    );

    return NextResponse.json({
      ok: true,
      launched: launched.map((l) => ({
        tier: l.tier,
        runId: l.runId,
        accounts: l.usernames.length,
        maxCostUsd: Number(l.estimatedCostUsd.toFixed(4)),
      })),
      note:
        launched.length === 0
          ? "No active competitors to poll."
          : "Runs queued; results arrive via the Apify webhook.",
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("cron failed:", message);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}

export const GET = handle;
export const POST = handle;
