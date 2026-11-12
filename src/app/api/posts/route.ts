import { NextResponse, type NextRequest } from "next/server";
import { query } from "@/lib/db";
import { authed, limitsFor } from "@/lib/session";
import { VISIBLE_POSTS_CTE } from "@/lib/feed";

export const dynamic = "force-dynamic";

/**
 * Whitelisted sort expressions. The key comes from the query string, so this
 * map is the only thing that may ever reach the ORDER BY clause.
 */
const SORTS: Record<string, string> = {
  recent: "p.posted_at DESC",
  oldest: "p.posted_at ASC",
  views: "p.views DESC, p.posted_at DESC",
  velocity: "p.views_per_hour DESC NULLS LAST, p.posted_at DESC",
  outlier: "p.outlier_score DESC NULLS LAST, p.views DESC",
  likes: "p.likes DESC, p.posted_at DESC",
  // Comments per view: a proxy for how much debate a hook provoked.
  engagement:
    "CASE WHEN p.views > 0 THEN (p.likes + p.comments)::numeric / p.views ELSE 0 END DESC",
};

export async function GET(req: NextRequest) {
  const a = await authed();
  if ("res" in a) return a.res;
  const { user } = a;
  const limits = limitsFor(user);

  const sp = new URL(req.url).searchParams;

  const sortKey = sp.get("sort") ?? "recent";
  const orderBy = SORTS[sortKey] ?? SORTS.recent;

  const limit = Math.min(Math.max(Number(sp.get("limit") ?? 60), 1), 200);
  const offset = Math.max(Number(sp.get("offset") ?? 0), 0);

  // $1 = user, $2 = how deep the plan reaches; filters start at $3.
  const params: unknown[] = [user.id, limits.reelsPerAccount];
  const conditions: string[] = ["TRUE"];

  const competitorId = sp.get("competitorId");
  if (competitorId && competitorId !== "all") {
    params.push(Number(competitorId));
    conditions.push(`p.competitor_id = $${params.length}`);
  }

  const days = sp.get("days");
  if (days && days !== "all") {
    params.push(Number(days));
    conditions.push(
      `p.posted_at > now() - ($${params.length}::int * interval '1 day')`
    );
  }

  if (sp.get("type") === "reels") conditions.push("p.is_reel");

  if (sp.get("outliersOnly") === "1") {
    params.push(Number(sp.get("outlierThreshold") ?? 3));
    conditions.push(`p.outlier_score >= $${params.length}`);
  }

  if (sp.get("watchlistOnly") === "1") {
    conditions.push("w.shortcode IS NOT NULL");
  }

  const audioId = sp.get("audioId");
  if (audioId) {
    params.push(audioId);
    conditions.push(`p.audio_id = $${params.length}`);
  }

  const search = sp.get("q")?.trim();
  if (search) {
    params.push(`%${search}%`);
    conditions.push(
      `(p.caption ILIKE $${params.length} OR c.username ILIKE $${params.length})`
    );
  }

  const where = conditions.join(" AND ");
  const filterParams = [...params];

  params.push(limit, offset);
  const limitParam = params.length - 1;
  const offsetParam = params.length;

  const rows = await query(
    `
    WITH ${VISIBLE_POSTS_CTE}
    SELECT
      p.shortcode, p.url, p.caption, p.hashtags, p.mentions,
      p.thumbnail_url, p.video_url,
      p.post_type, p.product_type, p.is_reel, p.duration_sec, p.posted_at,
      p.views, p.reach, p.likes, p.comments, p.is_paid_partnership,
      p.audio_id, p.audio_song, p.audio_artist, p.audio_is_original,
      p.outlier_score, p.views_per_hour, p.first_seen_at, p.last_updated_at,
      c.id AS competitor_id, c.username, c.display_name, c.profile_pic_url,
      c.median_views,
      w.status AS watchlist_status, w.note AS watchlist_note,
      (w.shortcode IS NOT NULL) AS is_watchlisted
    FROM visible v
    JOIN posts p ON p.shortcode = v.shortcode
    JOIN competitors c ON c.id = p.competitor_id
    LEFT JOIN user_watchlist w
      ON w.shortcode = p.shortcode AND w.user_id = $1
    WHERE ${where}
    ORDER BY ${orderBy}
    LIMIT $${limitParam} OFFSET $${offsetParam}
    `,
    params
  );

  const totals = await query<{ total: string }>(
    `
    WITH ${VISIBLE_POSTS_CTE}
    SELECT COUNT(*)::text AS total
    FROM visible v
    JOIN posts p ON p.shortcode = v.shortcode
    JOIN competitors c ON c.id = p.competitor_id
    LEFT JOIN user_watchlist w
      ON w.shortcode = p.shortcode AND w.user_id = $1
    WHERE ${where}
    `,
    filterParams
  );

  return NextResponse.json({
    posts: rows,
    total: Number(totals[0]?.total ?? 0),
    limit,
    offset,
    sort: sortKey in SORTS ? sortKey : "recent",
  });
}
