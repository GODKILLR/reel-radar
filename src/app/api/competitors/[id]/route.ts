import { NextResponse, type NextRequest } from "next/server";
import { query, queryOne } from "@/lib/db";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export async function PATCH(req: NextRequest, ctx: Ctx) {
  const { id } = await ctx.params;
  const competitorId = Number(id);
  if (!Number.isInteger(competitorId)) {
    return NextResponse.json({ error: "bad id" }, { status: 400 });
  }

  let payload: { is_active?: boolean; notes?: string };
  try {
    payload = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }

  const row = await queryOne(
    `
    UPDATE competitors SET
      is_active = COALESCE($2, is_active),
      notes     = COALESCE($3, notes)
    WHERE id = $1
    RETURNING id, username, is_active, notes
    `,
    [competitorId, payload.is_active ?? null, payload.notes ?? null]
  );

  if (!row) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json({ competitor: row });
}

export async function DELETE(_req: NextRequest, ctx: Ctx) {
  const { id } = await ctx.params;
  const competitorId = Number(id);
  if (!Number.isInteger(competitorId)) {
    return NextResponse.json({ error: "bad id" }, { status: 400 });
  }

  // ON DELETE CASCADE clears the account's posts, metrics and watchlist rows.
  await query(`DELETE FROM competitors WHERE id = $1`, [competitorId]);
  return NextResponse.json({ ok: true });
}
