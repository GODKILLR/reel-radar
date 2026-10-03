import { NextResponse, type NextRequest } from "next/server";
import { queryOne } from "@/lib/db";

export const dynamic = "force-dynamic";

const STATUSES = new Set(["idea", "scripted", "filmed", "posted"]);

/** Add a reel to the "to recreate" board, or update its status/note. */
export async function POST(req: NextRequest) {
  let payload: { shortcode?: string; status?: string; note?: string };
  try {
    payload = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
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

  try {
    const row = await queryOne(
      `
      INSERT INTO watchlist (shortcode, status, note)
      VALUES ($1, $2, $3)
      ON CONFLICT (shortcode) DO UPDATE SET
        status = EXCLUDED.status,
        note   = COALESCE(EXCLUDED.note, watchlist.note)
      RETURNING shortcode, status, note, added_at
      `,
      [shortcode, status, payload.note ?? null]
    );
    return NextResponse.json({ item: row });
  } catch {
    // The FK fails if the shortcode is not a post we track.
    return NextResponse.json(
      { error: "That post is not in the database." },
      { status: 404 }
    );
  }
}
