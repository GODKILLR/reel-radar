/**
 * Central tuning knobs. Everything here is overridable by env var so you can
 * trade Apify spend against freshness without touching code.
 */

import { REELS_PER_ACCOUNT } from "./plans";

function num(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export const config = {
  apify: {
    token: process.env.APIFY_TOKEN ?? "",
    /**
     * Which actor adapter to use: "lowcost" (default, $0.0003/post) or
     * "official" ($0.0027/post, adds reach + trending audio). See
     * src/lib/actors/ for the trade-offs.
     */
    actor: process.env.APIFY_ACTOR ?? "lowcost",
  },

  /** Hot tier: re-scraped on every poll so view velocity stays accurate. */
  hot: {
    windowDays: num("HOT_WINDOW_DAYS", 2),
    limitPerProfile: num("HOT_LIMIT", 8),
  },

  /**
   * Warm tier: older posts whose view counts barely move. Swept infrequently
   * to catch late-blooming reels and backfill anything the hot tier missed.
   */
  warm: {
    windowDays: num("WARM_WINDOW_DAYS", 30),
    limitPerProfile: num("WARM_LIMIT", 60),
    everyHours: num("WARM_EVERY_HOURS", 72),
  },

  /** One-time deep fetch when a competitor is first added. */
  backfill: {
    // Matches every plan's depth ("latest 100 reels per account"). Never fetch
    // more than we show: every extra reel is stored and paid for, and the
    // database is small.
    windowDays: num("BACKFILL_WINDOW_DAYS", 365),
    limitPerProfile: Math.min(num("BACKFILL_LIMIT", REELS_PER_ACCOUNT), REELS_PER_ACCOUNT),
  },

  metrics: {
    /**
     * Minimum gap between two snapshots of the same post. Apify retries a
     * failed webhook after about a minute, and a retry that re-ingests would
     * otherwise write a second snapshot seconds after the first -- velocity
     * reads the newest two, so that would produce a meaningless views/hour.
     * Polls are hours apart, so anything closer than this is a duplicate.
     */
    minGapMinutes: num("METRICS_MIN_GAP_MINUTES", 10),
    /**
     * Snapshots kept per post. Velocity only ever reads the newest two; the rest
     * is headroom. Older ones are deleted as new ones arrive.
     */
    keepSnapshots: Math.max(3, num("METRICS_KEEP", 6)),
  },

  /** Keeping the database inside a small (free) plan. See src/lib/cleanup.ts. */
  storage: {
    /** Size of the database plan, in MB (Neon free = 1 GB). */
    limitMb: num("DB_LIMIT_MB", 1024),
    /** Deleting whole accounts / users' tracking only starts above this fill. */
    cleanupAtPercent: num("CLEANUP_AT_PERCENT", 70),
    /** An account nobody tracks is deleted after this many days. */
    orphanDays: num("ORPHAN_DAYS", 30),
    /** A user unseen for this many days has their tracking links removed. */
    inactiveDays: num("INACTIVE_DAYS", 90),
    /** Photos/carousels kept per account (reels are kept up to the plan depth). */
    nonReelsKept: num("NON_REELS_KEPT", 20),
  },

  outlier: {
    /** Views >= this multiple of the account's own median => outlier. */
    threshold: num("OUTLIER_THRESHOLD", 3),
    /** Posts younger than this are too immature to score fairly. */
    minAgeHours: num("OUTLIER_MIN_AGE_HOURS", 24),
    /** How many recent mature posts form the baseline median. */
    baselineSize: num("OUTLIER_BASELINE_SIZE", 30),
  },

  secrets: {
    cron: process.env.CRON_SECRET ?? "",
    webhook: process.env.WEBHOOK_SECRET ?? "",
  },

  alerts: {
    telegramToken: process.env.TELEGRAM_BOT_TOKEN ?? "",
    telegramChatId: process.env.TELEGRAM_CHAT_ID ?? "",
    resendKey: process.env.RESEND_API_KEY ?? "",
    emailTo: process.env.ALERT_EMAIL_TO ?? "",
    emailFrom: process.env.ALERT_EMAIL_FROM ?? "alerts@localhost",
  },

  /** Public base URL, needed so Apify knows where to call back. */
  baseUrl:
    process.env.APP_BASE_URL ??
    (process.env.VERCEL_PROJECT_PRODUCTION_URL
      ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
      : "http://localhost:3000"),
};

export function assertConfigured() {
  const missing: string[] = [];
  if (!config.apify.token) missing.push("APIFY_TOKEN");
  if (!process.env.DATABASE_URL && !process.env.POSTGRES_URL)
    missing.push("DATABASE_URL");
  if (missing.length) {
    throw new Error(`Missing required env vars: ${missing.join(", ")}`);
  }
}
