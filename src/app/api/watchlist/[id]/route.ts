import { NextResponse, type NextRequest } from "next/server";
import { query } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function DELETE(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  const { id } = await ctx.params;
  await query(`DELETE FROM watchlist WHERE shortcode = $1`, [id]);
  return NextResponse.json({ ok: true });
}
