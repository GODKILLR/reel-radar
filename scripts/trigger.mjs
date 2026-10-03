#!/usr/bin/env node
/**
 * Fires a poll cycle against the deployed app, exactly as the scheduler does.
 *
 * Reads CRON_SECRET from .env and sends it as a bearer token; the secret is
 * never printed. Useful for testing the chain without waiting for the next
 * scheduled run.
 *
 *   npm run trigger              # hot tier
 *   npm run trigger -- backfill  # force a specific tier
 */
import { readFileSync, existsSync } from "node:fs";

const BASE = process.env.APP_BASE_URL ?? "https://reel-radar-chi.vercel.app";
const tier = process.argv[2] ?? "";

if (!existsSync(".env")) {
  console.error("No .env found. Run this from the reel-radar directory.");
  process.exit(1);
}

let secret = "";
for (const line of readFileSync(".env", "utf8").split(/\r?\n/)) {
  const t = line.trim();
  if (t.startsWith("CRON_SECRET=")) secret = t.slice("CRON_SECRET=".length).trim();
}
if (!secret) {
  console.error("CRON_SECRET is not set in .env.");
  process.exit(1);
}

const url = `${BASE}/api/cron${tier ? `?tier=${encodeURIComponent(tier)}` : ""}`;
console.log(`POST ${url}`);

const res = await fetch(url, {
  method: "POST",
  headers: { Authorization: `Bearer ${secret}` },
});

const body = await res.text();
console.log(`\nHTTP ${res.status}`);
try {
  console.log(JSON.stringify(JSON.parse(body), null, 2));
} catch {
  console.log(body.slice(0, 800));
}

if (res.ok) {
  console.log(
    "\nRuns are queued. Apify scrapes for a minute or two, then calls the\n" +
      "webhook, which ingests the results. Check the dashboard shortly."
  );
}
process.exit(res.ok ? 0 : 1);
