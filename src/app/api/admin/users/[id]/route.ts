import { NextResponse, type NextRequest } from "next/server";
import { transaction } from "@/lib/db";
import { adminOnly } from "@/lib/session";
import { PLANS, type PlanId } from "@/lib/plans";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

/**
 * Change a user's plan or grant/remove points. Until payments are connected
 * this is how a paid plan gets switched on by hand.
 */
export async function PATCH(req: NextRequest, ctx: Ctx) {
  const a = await adminOnly();
  if ("res" in a) return a.res;

  const { id } = await ctx.params;
  const userId = Number(id);
  if (!Number.isInteger(userId)) {
    return NextResponse.json({ error: "Bad id." }, { status: 400 });
  }

  let payload: { plan?: string; pointsDelta?: number; reason?: string };
  try {
    payload = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }

  const plan = payload.plan as PlanId | undefined;
  if (plan && !(plan in PLANS && plan !== "admin" && plan !== "connect")) {
    return NextResponse.json({ error: "Unknown plan." }, { status: 400 });
  }
  const delta = payload.pointsDelta;
  if (
    delta !== undefined &&
    (!Number.isInteger(delta) || Math.abs(delta) > 100_000)
  ) {
    return NextResponse.json({ error: "Bad points amount." }, { status: 400 });
  }

  const result = await transaction(async (tx) => {
    const [row] = await tx.query<{ points: number }>(
      `SELECT points FROM users WHERE id = $1 FOR UPDATE`,
      [userId]
    );
    if (!row) return null;

    if (plan) {
      await tx.query(`UPDATE users SET plan = $2 WHERE id = $1`, [userId, plan]);
    }
    let points = row.points;
    if (delta) {
      points = Math.max(0, row.points + delta);
      await tx.query(`UPDATE users SET points = $2 WHERE id = $1`, [
        userId,
        points,
      ]);
      await tx.query(
        `
        INSERT INTO points_ledger (user_id, delta, balance_after, reason)
        VALUES ($1, $2, $3, $4)
        `,
        [userId, points - row.points, points, payload.reason?.slice(0, 120) || "Granted by Star Labs"]
      );
    }
    return { plan: plan ?? null, points };
  });

  if (!result) return NextResponse.json({ error: "Not found." }, { status: 404 });
  return NextResponse.json({ ok: true, ...result });
}
