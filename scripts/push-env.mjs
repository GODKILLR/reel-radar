#!/usr/bin/env node
/**
 * Pushes the secrets from .env into Vercel.
 *
 * Run this yourself: the values are piped from your local .env straight into
 * the Vercel CLI over stdin, so they are never printed, logged, or shown to
 * anyone. Only the key names and a success/failure mark appear in the output.
 *
 *   npx vercel login        # once, opens a browser
 *   node scripts/push-env.mjs
 *
 * Re-running is safe: each variable is removed and re-added, so it ends up
 * with exactly one value per environment rather than duplicates.
 */
import { readFileSync, existsSync } from "node:fs";
import { spawn } from "node:child_process";

const SECRETS = [
  "DATABASE_URL",
  "APIFY_TOKEN",
  "CRON_SECRET",
  "WEBHOOK_SECRET",
  "DASHBOARD_PASSWORD",
];

const TARGETS = ["production", "preview", "development"];
const PROJECT = "reel-radar";
const SCOPE = "ketans-projects-7062cb5d";

if (!existsSync(".env")) {
  console.error("No .env found. Run this from the reel-radar directory.");
  process.exit(1);
}

// Parse .env without echoing anything.
const env = new Map();
for (const line of readFileSync(".env", "utf8").split(/\r?\n/)) {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith("#")) continue;
  const eq = trimmed.indexOf("=");
  if (eq < 1) continue;
  const key = trimmed.slice(0, eq).trim();
  const value = trimmed.slice(eq + 1).trim();
  if (value) env.set(key, value);
}

const missing = SECRETS.filter((k) => !env.has(k));
if (missing.length) {
  console.error(`.env is missing: ${missing.join(", ")}`);
  process.exit(1);
}

/** Runs the Vercel CLI, feeding `stdin` in without exposing it. */
function vercel(args, stdin = null) {
  return new Promise((resolve) => {
    const child = spawn(
      process.platform === "win32" ? "npx.cmd" : "npx",
      ["--yes", "vercel", ...args, "--scope", SCOPE],
      { stdio: [stdin === null ? "ignore" : "pipe", "pipe", "pipe"] }
    );

    let err = "";
    child.stdout.on("data", () => {});
    child.stderr.on("data", (d) => (err += d.toString()));

    if (stdin !== null) {
      child.stdin.write(stdin);
      child.stdin.end();
    }
    child.on("close", (code) => resolve({ code, err }));
  });
}

console.log(`Pushing ${SECRETS.length} secrets to ${PROJECT}...\n`);

let failed = 0;
for (const key of SECRETS) {
  const value = env.get(key);
  const marks = [];

  for (const target of TARGETS) {
    // Remove any existing value first so re-runs do not stack duplicates.
    // A missing variable makes this exit non-zero, which is expected.
    await vercel(["env", "rm", key, target, "--yes"]);

    const { code, err } = await vercel(["env", "add", key, target], value);
    if (code === 0) {
      marks.push(`${target} ok`);
    } else {
      failed++;
      marks.push(`${target} FAILED`);
      // Surface the reason without ever including the value.
      const reason = err.split("\n").find((l) => /error/i.test(l));
      if (reason) marks.push(`(${reason.trim().slice(0, 90)})`);
    }
  }
  console.log(`  ${key.padEnd(20)} ${marks.join(", ")}`);
}

console.log(
  failed === 0
    ? "\nAll secrets pushed. Next: redeploy with `npx vercel --prod`."
    : `\n${failed} assignment(s) failed. Check that you ran \`npx vercel login\`.`
);
process.exit(failed === 0 ? 0 : 1);
