import { NextResponse, type NextRequest } from "next/server";
import { authed, canCollect } from "@/lib/session";
import { runForUser, type CollectOutcome } from "@/lib/poller";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Plain-words status for each outcome. Nothing about how collection works. */
const MESSAGES: Record<CollectOutcome, string> = {
  started: "Collecting now. New reels usually appear within a few minutes.",
  nothing_due: "Everything is up to date.",
  in_progress: "Still collecting. New reels usually appear within a few minutes.",
  cooldown: "Refreshed a moment ago. Try again in a few minutes.",
  no_key: "Connect your Apify key first.",
  invalid: "Your Apify key stopped working. Reconnect it to keep collecting.",
  out_of_credit:
    "Your Apify credit has run out for this month. Collection resumes when it renews.",
  unreachable: "We couldn't reach Apify just now. Try again in a minute.",
};

/**
 * Collect for the signed-in user, on their own key, right now. This is what
 * makes collection happen when the USER asks (adds an account, opens the app,
 * presses Refresh) instead of waiting for a timer. Safe to call often: it does
 * nothing, and touches nothing external, unless something is actually due.
 */
export async function POST(req: NextRequest) {
  const a = await authed();
  if ("res" in a) return a.res;
  const { user } = a;

  if (!canCollect(user)) {
    return NextResponse.json(
      { outcome: "no_key", message: MESSAGES.no_key, launched: [] },
      { status: 200 }
    );
  }

  let force = false;
  try {
    const body = (await req.json()) as { force?: unknown };
    force = body.force === true;
  } catch {
    // No body is fine: an automatic check.
  }

  const result = await runForUser(user.id, { force });
  return NextResponse.json({
    outcome: result.outcome,
    message: MESSAGES[result.outcome],
    launched: result.launched,
  });
}
