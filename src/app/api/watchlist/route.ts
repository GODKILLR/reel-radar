import { NextResponse, type NextRequest } from "next/server";
import { queryOne } from "@/lib/db";
import { authed } from "@/lib/session";

export const dynamic = "force-dynamic";

const STATUSES = new Set(["idea", "scripted", "filmed", "posted"]);

/** Add a reel to the user's "to recreate" board, or update its status/note. */
export async function POST(req: NextRequest) {
  const a = await authed();
  if ("res" in a) return a.res;
  const { user } = a;

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

  const post = await queryOne(`SELECT 1 FROM posts WHERE shortcode = $1`, [
    shortcode,
  ]);
  if (!post) {
    return NextResponse.json(
      { error: "That post is not available." },
      { status: 404 }
    );
  }

  const item = await queryOne(
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
  return NextResponse.json({ item });
}
