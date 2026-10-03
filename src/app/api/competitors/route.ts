import { NextResponse, type NextRequest } from "next/server";
import { query, queryOne } from "@/lib/db";
import { config } from "@/lib/config";
import { parseUsername } from "@/lib/username";

export const dynamic = "force-dynamic";

export async function GET() {
  const rows = await query(
    `
    SELECT
      c.id, c.username, c.display_name, c.profile_pic_url, c.followers,
      c.is_active, c.backfilled_at, c.last_scraped_at, c.median_views,
      c.post_count, c.notes,
      (SELECT COUNT(*) FROM posts p
        WHERE p.competitor_id = c.id AND p.posted_at > now() - interval '7 days'
      ) AS posts_last_7d,
      (SELECT COUNT(*) FROM posts p
        WHERE p.competitor_id = c.id AND p.outlier_score >= $1
          AND p.posted_at > now() - interval '30 days'
      ) AS outliers_last_30d
    FROM competitors c
    ORDER BY c.username
    `,
    [config.outlier.threshold]
  );
  return NextResponse.json({ competitors: rows });
}

export async function POST(req: NextRequest) {
  let payload: { username?: string; notes?: string };
  try {
    payload = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }

  const username = parseUsername(payload.username ?? "");
  if (!username) {
    return NextResponse.json(
      { error: "Enter a valid Instagram handle or profile URL." },
      { status: 400 }
    );
  }

  const existing = await queryOne<{ id: number }>(
    `SELECT id FROM competitors WHERE username = $1`,
    [username]
  );
  if (existing) {
    return NextResponse.json(
      { error: `@${username} is already being tracked.` },
      { status: 409 }
    );
  }

  const row = await queryOne(
    `
    INSERT INTO competitors (username, notes)
    VALUES ($1, $2)
    RETURNING id, username, is_active, created_at
    `,
    [username, payload.notes ?? null]
  );

  // backfilled_at stays null, so the next poll cycle picks this account up for
  // its one-time history fetch automatically.
  return NextResponse.json({ competitor: row }, { status: 201 });
}
