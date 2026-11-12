import { NextResponse } from "next/server";
import { query } from "@/lib/db";
import { config } from "@/lib/config";
import { authed, limitsFor } from "@/lib/session";

export const dynamic = "force-dynamic";

/**
 * Discover: this month's strongest outliers from accounts Star Labs features.
 * Costs nothing extra - those accounts are tracked anyway - so it gives a new
 * user value before they have added a single account. How many they can see
 * depends on their plan; the rest is shown as a locked teaser count.
 */
export async function GET() {
  const a = await authed();
  if ("res" in a) return a.res;
  const { user } = a;
  const limits = limitsFor(user);

  // $1 = outlier threshold. Shared by the count and the page of results.
  const featured = `
    c.is_curated AND c.is_active
      AND p.is_reel
      AND p.outlier_score >= $1
      AND p.posted_at > now() - interval '45 days'
  `;

  const [{ total }] = await query<{ total: string }>(
    `
    SELECT COUNT(*)::text AS total
    FROM posts p
    JOIN competitors c ON c.id = p.competitor_id
    WHERE ${featured}
    `,
    [config.outlier.threshold]
  );

  const posts = await query(
    `
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
    FROM posts p
    JOIN competitors c ON c.id = p.competitor_id
    LEFT JOIN user_watchlist w
      ON w.shortcode = p.shortcode AND w.user_id = $3
    WHERE ${featured}
    ORDER BY p.outlier_score DESC, p.views DESC
    LIMIT $2
    `,
    [config.outlier.threshold, limits.discoverLimit, user.id]
  );

  const totalCount = Number(total);
  return NextResponse.json({
    posts,
    total: totalCount,
    shown: posts.length,
    locked: Math.max(0, totalCount - posts.length),
  });
}
