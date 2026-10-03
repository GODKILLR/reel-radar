#!/usr/bin/env node
/**
 * Creates (or updates) the cron-job.org job that triggers the poll.
 *
 * Run this yourself. CRON_SECRET is read from .env and sent only to
 * cron-job.org as an Authorization header; it is never printed or logged.
 *
 *   node scripts/setup-cron.mjs <cron-job.org-api-key>
 *
 * Re-running updates the existing job rather than creating a duplicate.
 */
import { readFileSync, existsSync } from "node:fs";

const API = "https://api.cron-job.org";
const TITLE = "Reel Radar poll";
const DEFAULT_URL = "https://reel-radar-chi.vercel.app/api/cron";

const apiKey = process.argv[2] ?? process.env.CRONJOB_API_KEY;
const targetUrl = process.argv[3] ?? process.env.APP_CRON_URL ?? DEFAULT_URL;

if (!apiKey) {
  console.error("Usage: node scripts/setup-cron.mjs <cron-job.org-api-key>");
  console.error("Find the key under Settings -> API in your cron-job.org account.");
  process.exit(1);
}

if (!existsSync(".env")) {
  console.error("No .env found. Run this from the reel-radar directory.");
  process.exit(1);
}

// Pull CRON_SECRET out without echoing it.
let cronSecret = "";
for (const line of readFileSync(".env", "utf8").split(/\r?\n/)) {
  const trimmed = line.trim();
  if (!trimmed.startsWith("CRON_SECRET=")) continue;
  cronSecret = trimmed.slice("CRON_SECRET=".length).trim();
}
if (!cronSecret) {
  console.error("CRON_SECRET is not set in .env.");
  process.exit(1);
}

async function api(path, options = {}) {
  const res = await fetch(`${API}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      ...(options.headers ?? {}),
    },
  });
  const text = await res.text();
  let body;
  try {
    body = text ? JSON.parse(text) : {};
  } catch {
    body = { raw: text };
  }
  if (!res.ok) {
    throw new Error(`${path} -> ${res.status}: ${text.slice(0, 200)}`);
  }
  return body;
}

// Every two hours, on the hour. -1 means "every" for that field.
const job = {
  url: targetUrl,
  enabled: true,
  saveResponses: true,
  title: TITLE,
  requestMethod: 0, // GET
  schedule: {
    timezone: "Asia/Kolkata",
    expiresAt: 0,
    hours: [0, 2, 4, 6, 8, 10, 12, 14, 16, 18, 20, 22],
    minutes: [0],
    mdays: [-1],
    months: [-1],
    wdays: [-1],
  },
  extendedData: {
    // Sent as a header rather than a query string so the secret stays out of
    // request logs and the job's URL field.
    headers: { Authorization: `Bearer ${cronSecret}` },
  },
};

const { jobs = [] } = await api("/jobs");
const existing = jobs.find((j) => j.title === TITLE || j.url === targetUrl);

if (existing) {
  await api(`/jobs/${existing.jobId}`, {
    method: "PATCH",
    body: JSON.stringify({ job }),
  });
  console.log(`Updated existing job ${existing.jobId}`);
} else {
  const created = await api("/jobs", {
    method: "PUT",
    body: JSON.stringify({ job }),
  });
  console.log(`Created job ${created.jobId}`);
}

// Read back what the service actually stored, so the schedule is confirmed
// rather than assumed.
const { jobs: after = [] } = await api("/jobs");
const mine = after.find((j) => j.title === TITLE);
if (mine) {
  console.log(`  url:      ${mine.url}`);
  console.log(`  enabled:  ${mine.enabled}`);
  console.log(`  schedule: hours ${mine.schedule?.hours?.join(",")} at :${String(mine.schedule?.minutes?.[0] ?? 0).padStart(2, "0")} (${mine.schedule?.timezone})`);
  console.log(
    `  next run: ${mine.nextExecution ? new Date(mine.nextExecution * 1000).toISOString() : "unknown"}`
  );
}
console.log("\nThe Authorization header carries CRON_SECRET and was not printed.");
