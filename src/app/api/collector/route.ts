import { NextResponse, type NextRequest } from "next/server";
import { query } from "@/lib/db";
import { authed } from "@/lib/session";
import {
  checkToken,
  encryptToken,
  encryptionEnabled,
  getCollectorInfo,
  looksLikeToken,
} from "@/lib/collector";

export const dynamic = "force-dynamic";

/** Best-effort guard against hammering the check endpoint. */
const lastAttempt = new Map<number, number>();
const MIN_GAP_MS = 3_000;

/** The user's collector state. Never includes the key itself. */
export async function GET() {
  const a = await authed();
  if ("res" in a) return a.res;
  return NextResponse.json(await getCollectorInfo(a.user.id));
}

/** Connect (or replace) the user's own key after proving it works. */
export async function POST(req: NextRequest) {
  const a = await authed();
  if ("res" in a) return a.res;
  const { user } = a;

  if (!encryptionEnabled()) {
    return NextResponse.json(
      { error: "Connecting your own key isn't available right now." },
      { status: 503 }
    );
  }

  const now = Date.now();
  if (now - (lastAttempt.get(user.id) ?? 0) < MIN_GAP_MS) {
    return NextResponse.json(
      { error: "Please wait a few seconds and try again." },
      { status: 429 }
    );
  }
  lastAttempt.set(user.id, now);

  let payload: { token?: unknown };
  try {
    payload = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }

  if (!looksLikeToken(payload.token)) {
    return NextResponse.json(
      {
        error:
          "That doesn't look like an API token. Copy the full token from your Apify account's API & Integrations page.",
      },
      { status: 400 }
    );
  }
  const token = payload.token.trim();

  const check = await checkToken(token);
  if (check.state === "invalid") {
    return NextResponse.json(
      {
        error:
          "That key didn't work. Copy it again from Apify → Settings → API & Integrations.",
      },
      { status: 400 }
    );
  }
  if (check.state === "unreachable") {
    return NextResponse.json(
      { error: "We couldn't reach Apify just now. Try again in a minute." },
      { status: 502 }
    );
  }

  await query(
    `
    UPDATE users SET
      collector_key_enc     = $2,
      collector_key_last4   = $3,
      collector_status      = $4,
      collector_checked_at  = now(),
      collector_credit_left = $5,
      collector_resets_at   = $6::timestamptz
    WHERE id = $1
    `,
    [
      user.id,
      encryptToken(token, user.id),
      token.slice(-4),
      check.state,
      check.creditLeftUsd,
      check.resetsAt,
    ]
  );

  return NextResponse.json(await getCollectorInfo(user.id), { status: 201 });
}

/**
 * Disconnect. Their tracked accounts simply stop being collected - there is no
 * fallback onto our own collection, so there is nothing to abuse here.
 */
export async function DELETE() {
  const a = await authed();
  if ("res" in a) return a.res;
  const { user } = a;

  await query(
    `
    UPDATE users SET
      collector_key_enc = NULL, collector_key_last4 = NULL,
      collector_status = NULL, collector_checked_at = NULL,
      collector_credit_left = NULL, collector_resets_at = NULL
    WHERE id = $1
    `,
    [user.id]
  );
  return NextResponse.json({ ok: true });
}
