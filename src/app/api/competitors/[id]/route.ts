import { NextResponse, type NextRequest } from "next/server";
import { query } from "@/lib/db";
import { authed } from "@/lib/session";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

/**
 * Stop tracking an account. This only removes the user's own link: the posts
 * stay in the shared pool because other users may still track the account.
 * Points spent adding it are not refunded.
 */
export async function DELETE(_req: NextRequest, ctx: Ctx) {
  const a = await authed();
  if ("res" in a) return a.res;

  const { id } = await ctx.params;
  const competitorId = Number(id);
  if (!Number.isInteger(competitorId)) {
    return NextResponse.json({ error: "Bad id." }, { status: 400 });
  }

  await query(
    `DELETE FROM user_competitors WHERE user_id = $1 AND competitor_id = $2`,
    [a.user.id, competitorId]
  );
  // Their saved ideas from that account stay on their board.
  return NextResponse.json({ ok: true });
}
