import { NextResponse } from "next/server";
import { query } from "@/lib/db";
import { authed, publicUser } from "@/lib/session";
import { ADD_ACCOUNT_COST, PUBLIC_PLANS } from "@/lib/plans";

export const dynamic = "force-dynamic";

/** The signed-in user, their usage against plan limits, and recent points. */
export async function GET() {
  const a = await authed();
  if ("res" in a) return a.res;
  const { user } = a;

  const [usage] = await query<{ accounts: string; saved: string }>(
    `
    SELECT
      (SELECT COUNT(*) FROM user_competitors WHERE user_id = $1) AS accounts,
      (SELECT COUNT(*) FROM user_watchlist   WHERE user_id = $1) AS saved
    `,
    [user.id]
  );

  const ledger = await query(
    `
    SELECT delta, balance_after, reason, created_at
    FROM points_ledger WHERE user_id = $1
    ORDER BY created_at DESC, id DESC LIMIT 20
    `,
    [user.id]
  );

  return NextResponse.json({
    user: publicUser(user),
    usage: {
      accounts: Number(usage?.accounts ?? 0),
      saved: Number(usage?.saved ?? 0),
    },
    ledger,
    addAccountCost: ADD_ACCOUNT_COST,
    plans: PUBLIC_PLANS,
  });
}
