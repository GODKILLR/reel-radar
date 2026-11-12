import { NextResponse, type NextRequest } from "next/server";
import { queryOne } from "@/lib/db";
import { adminOnly } from "@/lib/session";
import { PUBLIC_PLANS } from "@/lib/plans";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

/**
 * Change a user's plan. Until payments are connected this is how a paid plan
 * gets switched on by hand.
 */
export async function PATCH(req: NextRequest, ctx: Ctx) {
  const a = await adminOnly();
  if ("res" in a) return a.res;

  const { id } = await ctx.params;
  const userId = Number(id);
  if (!Number.isInteger(userId)) {
    return NextResponse.json({ error: "Bad id." }, { status: 400 });
  }

  let payload: { plan?: string };
  try {
    payload = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }

  if (!payload.plan || !PUBLIC_PLANS.some((p) => p.id === payload.plan)) {
    return NextResponse.json({ error: "Unknown plan." }, { status: 400 });
  }

  const row = await queryOne<{ plan: string }>(
    `UPDATE users SET plan = $2 WHERE id = $1 RETURNING plan`,
    [userId, payload.plan]
  );
  if (!row) return NextResponse.json({ error: "Not found." }, { status: 404 });
  return NextResponse.json({ ok: true, plan: row.plan });
}
