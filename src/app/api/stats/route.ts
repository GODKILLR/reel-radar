import { NextResponse } from "next/server";
import { query, queryOne } from "@/lib/db";
import { config } from "@/lib/config";
import { getAdapter } from "@/lib/actors";

export const dynamic = "force-dynamic";

export async function GET() {
  const summary = await queryOne(
    `
    SELECT
      (SELECT COUNT(*) FROM competitors WHERE is_active) AS active_competitors,
      (SELECT COUNT(*) FROM posts) AS total_posts,
      (SELECT COUNT(*) FROM posts
        WHERE posted_at > now() - interval '24 hours') AS posts_last_24h,
      (SELECT COUNT(*) FROM posts
        WHERE outlier_score >= $1
          AND posted_at > now() - interval '7 days') AS outliers_last_7d,
      (SELECT COUNT(*) FROM watchlist) AS watchlist_count
    `,
    [config.outlier.threshold]
  );

  const lastRun = await queryOne(
    `
    SELECT tier, status, posts_seen, posts_new, cost_usd, started_at,
           finished_at, error
    FROM scrape_runs
    ORDER BY started_at DESC
    LIMIT 1
    `
  );

  // Rolling Apify spend, so cost never becomes a surprise at month end.
  const spend = await queryOne(
    `
    SELECT
      COALESCE(SUM(cost_usd) FILTER (
        WHERE started_at > now() - interval '24 hours'), 0)::numeric AS last_24h,
      COALESCE(SUM(cost_usd) FILTER (
        WHERE started_at > now() - interval '30 days'), 0)::numeric AS last_30d
    FROM scrape_runs
    WHERE status = 'succeeded'
    `
  );

  const recentRuns = await query(
    `
    SELECT tier, status, posts_seen, posts_new, cost_usd, started_at, error
    FROM scrape_runs
    ORDER BY started_at DESC
    LIMIT 10
    `
  );

  return NextResponse.json({
    summary,
    lastRun,
    spend,
    recentRuns,
    settings: {
      outlierThreshold: config.outlier.threshold,
      hotWindowDays: config.hot.windowDays,
      warmEveryHours: config.warm.everyHours,
      actor: getAdapter().label,
      costPerPostUsd: getAdapter().costPerPostUsd,
    },
  });
}
