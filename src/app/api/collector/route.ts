import { NextResponse, type NextRequest } from "next/server";
import { queryOne, query } from "@/lib/db";
import { authed } from "@/lib/session";
import {
  checkToken,
  encryptToken,
  encryptionEnabled,
  getCollectorInfo,
  looksLikeToken,
} from "@/lib/collector";
import { PLANS } from "@/lib/plans";

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

  // Managed plans already include collection; letting them also bring a key
  // would only muddy who pays for what.
  if (!user.isAdmin && user.plan !== "free") {
    return NextResponse.json(
      { error: "Your plan already includes collection - no key needed." },
      { status: 409 }
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
 * Disconnect. Refused while the user tracks more accounts than the Free plan
 * allows: otherwise connect -> add 30 accounts -> disconnect would hand all 30
 * to our own collection bill.
 */
export async function DELETE() {
  const a = await authed();
  if ("res" in a) return a.res;
  const { user } = a;

  if (!user.isAdmin) {
    const row = await queryOne<{ n: string }>(
      `SELECT COUNT(*)::text AS n FROM user_competitors WHERE user_id = $1`,
      [user.id]
    );
    const tracked = Number(row?.n ?? 0);
    const freeMax = PLANS.free.maxAccounts;
    if (tracked > freeMax) {
      const over = tracked - freeMax;
      return NextResponse.json(
        {
          error: `Stop tracking ${over} account${over === 1 ? "" : "s"} first: the Free plan without your own key tracks up to ${freeMax}.`,
          code: "over_free_limit",
        },
        { status: 409 }
      );
    }
  }

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
