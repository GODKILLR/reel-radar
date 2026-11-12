import { NextResponse } from "next/server";
import { query, queryOne } from "@/lib/db";
import { adminOnly } from "@/lib/session";
import { getAdapter } from "@/lib/actors";

export const dynamic = "force-dynamic";

/**
 * Operator view: users, every tracked account, and what collection really
 * costs. This is the only place cost and vendor detail are exposed, and only
 * to admins.
 */
export async function GET() {
  const a = await adminOnly();
  if ("res" in a) return a.res;

  const users = await query(
    `
    SELECT u.id, u.email, u.name, u.plan, u.points, u.is_admin, u.created_at,
           u.last_login_at, u.collector_status,
           (u.collector_key_enc IS NOT NULL) AS has_key,
           (SELECT COUNT(*) FROM user_competitors uc WHERE uc.user_id = u.id)
             AS accounts
    FROM users u
    ORDER BY u.created_at DESC
    LIMIT 500
    `
  );

  const competitors = await query(
    `
    SELECT c.id, c.username, c.is_active, c.is_curated, c.backfilled_at,
           c.last_scraped_at, c.post_count,
           (SELECT COUNT(*) FROM user_competitors uc
             WHERE uc.competitor_id = c.id) AS trackers
    FROM competitors c
    ORDER BY c.is_curated DESC, trackers DESC, c.username
    `
  );

  const spend = await queryOne(
    `
    SELECT
      COALESCE(SUM(cost_usd) FILTER (
        WHERE started_at > now() - interval '24 hours'), 0)::numeric AS last_24h,
      COALESCE(SUM(cost_usd) FILTER (
        WHERE started_at > now() - interval '30 days'), 0)::numeric AS last_30d
    FROM scrape_runs
    -- Only runs on OUR key are our cost; runs on a user's own key are theirs.
    WHERE status = 'succeeded' AND owner_user_id IS NULL
    `
  );

  const runs = await query(
    `
    SELECT tier, status, posts_seen, posts_new, cost_usd, started_at, error,
           (owner_user_id IS NOT NULL) AS user_key
    FROM scrape_runs ORDER BY started_at DESC LIMIT 10
    `
  );

  const plans = await query<{ plan: string; n: string }>(
    `SELECT plan, COUNT(*)::text AS n FROM users GROUP BY plan`
  );

  return NextResponse.json({
    users,
    competitors,
    spend,
    runs,
    plans,
    collector: {
      label: getAdapter().label,
      costPerPostUsd: getAdapter().costPerPostUsd,
    },
  });
}
