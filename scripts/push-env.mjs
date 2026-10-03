#!/usr/bin/env node
/**
 * Pushes the secrets from .env into Vercel.
 *
 * Run this yourself: the values are piped from your local .env straight into
 * the Vercel CLI over stdin, so they are never printed, logged, or shown to
 * anyone. Only the key names and a success/failure mark appear in the output.
 *
 *   npx vercel login        # once, opens a browser
 *   npx vercel link         # once, pick the existing reel-radar project
 *   npm run push-env
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

/**
 * On Windows the npm shims are .cmd batch files, and since Node 18.20 / 20.12
 * spawn() refuses to execute those without a shell (it throws EINVAL). Every
 * argument here is a fixed identifier -- key names, environment names -- and
 * the secret itself travels over stdin, never argv, so the shell never sees it.
 */
const IS_WIN = process.platform === "win32";

function vercel(args, stdin = null) {
  return new Promise((resolve) => {
    let child;
    try {
      child = spawn("npx", ["--yes", "vercel", ...args], {
        shell: IS_WIN,
        stdio: [stdin === null ? "ignore" : "pipe", "pipe", "pipe"],
      });
    } catch (err) {
      resolve({ code: -1, out: "", err: String(err) });
      return;
    }

    let out = "";
    let err = "";
    child.stdout.on("data", (d) => (out += d.toString()));
    child.stderr.on("data", (d) => (err += d.toString()));
    child.on("error", (e) => resolve({ code: -1, out, err: String(e) }));

    if (stdin !== null) {
      child.stdin.write(stdin);
      child.stdin.end();
    }
    child.on("close", (code) => resolve({ code, out, err }));
  });
}

function fail(message, hint) {
  console.error(`\n${message}`);
  if (hint) console.error(`   ${hint}`);
  process.exit(1);
}

// ---- preflight -------------------------------------------------------------

if (!existsSync(".env")) {
  fail("No .env found.", "Run this from the reel-radar directory.");
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
if (missing.length) fail(`.env is missing values for: ${missing.join(", ")}`);

process.stdout.write("Checking Vercel CLI... ");
const who = await vercel(["whoami"]);
if (who.code !== 0) {
  console.log("not signed in");
  fail("Not signed in to Vercel.", "Run:  npx vercel login");
}
console.log(`signed in as ${who.out.trim() || "(unknown)"}`);

// The CLI writes repo.json when it detects a git repository and project.json
// otherwise. Either one means we are linked.
if (
  !existsSync(".vercel/repo.json") &&
  !existsSync(".vercel/project.json")
) {
  fail(
    "This folder is not linked to a Vercel project.",
    "Run:  npx vercel link --yes --project reel-radar"
  );
}

// ---- push ------------------------------------------------------------------

console.log(`\nPushing ${SECRETS.length} secrets...\n`);

let failed = 0;
for (const key of SECRETS) {
  const value = env.get(key);
  const marks = [];
  let reason = "";

  for (const target of TARGETS) {
    // Remove any existing value first so re-runs do not stack duplicates.
    // A missing variable makes this exit non-zero, which is expected.
    await vercel(["env", "rm", key, target, "--yes"]);

    const res = await vercel(["env", "add", key, target], value);
    if (res.code === 0) {
      marks.push(`${target} ok`);
    } else {
      failed++;
      marks.push(`${target} FAILED`);
      // Surface the reason without ever including the value.
      reason ||=
        res.err.split("\n").find((l) => /error|denied|not found/i.test(l)) ?? "";
    }
  }

  console.log(`  ${key.padEnd(20)} ${marks.join(", ")}`);
  if (reason) console.log(`  ${" ".repeat(20)} ${reason.trim().slice(0, 100)}`);
}

if (failed === 0) {
  console.log("\nAll secrets pushed. Next:  npx vercel --prod");
  process.exit(0);
}
console.log(`\n${failed} assignment(s) failed -- see the reasons above.`);
process.exit(1);
