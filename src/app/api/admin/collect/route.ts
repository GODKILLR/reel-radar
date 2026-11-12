import { NextResponse } from "next/server";
import { adminOnly } from "@/lib/session";
import { runPlatformNow } from "@/lib/poller";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Collect the platform's own accounts (featured + admins') right now, without
 * waiting for a scheduler. Never touches any user's key.
 */
export async function POST() {
  const a = await adminOnly();
  if ("res" in a) return a.res;

  const launched = await runPlatformNow();
  return NextResponse.json({
    ok: true,
    launched: launched.map((l) => ({ tier: l.tier, accounts: l.usernames.length })),
  });
}
