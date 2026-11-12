import { NextResponse, type NextRequest } from "next/server";
import { queryOne } from "@/lib/db";
import { adminOnly } from "@/lib/session";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

/** Feature an account in Discover, or pause/resume collecting it. */
export async function PATCH(req: NextRequest, ctx: Ctx) {
  const a = await adminOnly();
  if ("res" in a) return a.res;

  const { id } = await ctx.params;
  const competitorId = Number(id);
  if (!Number.isInteger(competitorId)) {
    return NextResponse.json({ error: "Bad id." }, { status: 400 });
  }

  let payload: { is_curated?: boolean; is_active?: boolean };
  try {
    payload = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }

  const row = await queryOne(
    `
    UPDATE competitors SET
      is_curated = COALESCE($2, is_curated),
      is_active  = COALESCE($3, is_active)
    WHERE id = $1
    RETURNING id, username, is_curated, is_active
    `,
    [competitorId, payload.is_curated ?? null, payload.is_active ?? null]
  );
  if (!row) return NextResponse.json({ error: "Not found." }, { status: 404 });
  return NextResponse.json({ competitor: row });
}
