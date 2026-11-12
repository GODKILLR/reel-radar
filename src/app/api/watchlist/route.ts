import { NextResponse, type NextRequest } from "next/server";
import { transaction } from "@/lib/db";
import { authed, limitsFor } from "@/lib/session";

export const dynamic = "force-dynamic";

const STATUSES = new Set(["idea", "scripted", "filmed", "posted"]);

/** Add a reel to the user's "to recreate" board, or update its status/note. */
export async function POST(req: NextRequest) {
  const a = await authed();
  if ("res" in a) return a.res;
  const { user } = a;
  const limits = limitsFor(user);

  let payload: { shortcode?: string; status?: string; note?: string };
  try {
    payload = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }

  const shortcode = payload.shortcode?.trim();
  if (!shortcode) {
    return NextResponse.json({ error: "shortcode required" }, { status: 400 });
  }

  const status = payload.status ?? "idea";
  if (!STATUSES.has(status)) {
    return NextResponse.json(
      { error: `status must be one of: ${[...STATUSES].join(", ")}` },
      { status: 400 }
    );
  }

  const outcome = await transaction(async (tx) => {
    // Serialise this user's saves so the limit check cannot be raced.
    await tx.query(`SELECT 1 FROM users WHERE id = $1 FOR UPDATE`, [user.id]);

    const [post] = await tx.query(`SELECT 1 FROM posts WHERE shortcode = $1`, [
      shortcode,
    ]);
    if (!post) return { error: "That post is not available.", status: 404 };

    const [existing] = await tx.query(
      `SELECT 1 FROM user_watchlist WHERE user_id = $1 AND shortcode = $2`,
      [user.id, shortcode]
    );
    if (!existing) {
      const [{ n }] = await tx.query<{ n: string }>(
        `SELECT COUNT(*)::text AS n FROM user_watchlist WHERE user_id = $1`,
        [user.id]
      );
      if (Number(n) >= limits.savedLimit) {
        return {
          error: `Your plan saves up to ${limits.savedLimit} reels. Remove one to save another${user.isAdmin ? "." : ", or upgrade for unlimited."}`,
          status: 403,
          code: "saved_limit",
        };
      }
    }

    const [item] = await tx.query(
      `
      INSERT INTO user_watchlist (user_id, shortcode, status, note)
      VALUES ($1, $2, $3, $4)
      ON CONFLICT (user_id, shortcode) DO UPDATE SET
        status = EXCLUDED.status,
        note   = COALESCE(EXCLUDED.note, user_watchlist.note)
      RETURNING shortcode, status, note, added_at
      `,
      [user.id, shortcode, status, payload.note ?? null]
    );
    return { item };
  });

  if ("error" in outcome) {
    return NextResponse.json(
      { error: outcome.error, code: outcome.code },
      { status: outcome.status }
    );
  }
  return NextResponse.json({ item: outcome.item });
}
