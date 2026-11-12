import { NextResponse, type NextRequest } from "next/server";
import { query } from "@/lib/db";
import { authed } from "@/lib/session";

export const dynamic = "force-dynamic";

export async function DELETE(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  const a = await authed();
  if ("res" in a) return a.res;

  const { id } = await ctx.params;
  await query(
    `DELETE FROM user_watchlist WHERE user_id = $1 AND shortcode = $2`,
    [a.user.id, id]
  );
  return NextResponse.json({ ok: true });
}
