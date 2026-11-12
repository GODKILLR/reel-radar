import { NextResponse } from "next/server";
import { queryOne } from "@/lib/db";
import { config } from "@/lib/config";
import { authed, limitsFor } from "@/lib/session";
import { VISIBLE_POSTS_CTE } from "@/lib/feed";

export const dynamic = "force-dynamic";

/**
 * Numbers for the signed-in user's header strip. Deliberately says nothing
 * about how data is collected or what it costs: users get a freshness hint and
 * their own counts, nothing about the machinery behind them.
 */
export async function GET() {
  const a = await authed();
  if ("res" in a) return a.res;
  const { user } = a;
  const limits = limitsFor(user);

  const summary = await queryOne(
    `
    WITH ${VISIBLE_POSTS_CTE}
    SELECT
      (SELECT COUNT(*) FROM user_competitors WHERE user_id = $1) AS accounts,
      (SELECT COUNT(*) FROM visible) AS total_posts,
      (SELECT COUNT(*) FROM visible v JOIN posts p ON p.shortcode = v.shortcode
        WHERE p.posted_at > now() - interval '24 hours') AS posts_last_24h,
      (SELECT COUNT(*) FROM visible v JOIN posts p ON p.shortcode = v.shortcode
        WHERE p.outlier_score >= $3
          AND p.posted_at > now() - interval '7 days') AS outliers_last_7d,
      (SELECT COUNT(*) FROM user_watchlist WHERE user_id = $1) AS saved,
      (SELECT MAX(c.last_scraped_at)
         FROM user_competitors uc JOIN competitors c ON c.id = uc.competitor_id
        WHERE uc.user_id = $1) AS updated_at
    `,
    [user.id, limits.reelsPerAccount, config.outlier.threshold]
  );

  const updatedAt = (summary?.updated_at as string | null) ?? null;
  // "Delayed" means well past the plan's refresh interval - a gentle hint,
  // with no detail about why.
  const delayed =
    updatedAt !== null &&
    Date.now() - new Date(updatedAt).getTime() >
      (limits.refreshHours * 2 + 4) * 3_600_000;

  return NextResponse.json({
    summary: {
      accounts: summary?.accounts ?? "0",
      total_posts: summary?.total_posts ?? "0",
      posts_last_24h: summary?.posts_last_24h ?? "0",
      outliers_last_7d: summary?.outliers_last_7d ?? "0",
      saved: summary?.saved ?? "0",
    },
    freshness: { updatedAt, delayed },
    settings: { outlierThreshold: config.outlier.threshold },
  });
}
