// One command runs every end-to-end suite:  npm run e2e
//
// It starts, on this machine only:
//   - a throwaway embedded Postgres            (port 5433)
//   - a FAKE collector service                 (port 4010)
//   - the app itself, pointed at the two above (port 3000)
// then runs each suite against a freshly reset database and tears it all down.
//
// The environment below is passed to the app explicitly, and process env wins
// over .env files, so even a developer with a real .env can NOT reach their real
// database or real collector through this script.
import { spawn, spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import path from "node:path";

const require = createRequire(import.meta.url);
const { Client } = require("pg");
const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const E2E = fileURLToPath(new URL(".", import.meta.url));
const DB_URL = "postgres://test:test@localhost:5433/rr_test";
const SUITES = ["e2e-plans.mjs", "e2e-ondemand.mjs", "e2e-views.mjs"];

const ENV = {
  ...process.env,
  DATABASE_URL: DB_URL,
  APIFY_API_BASE: "http://localhost:4010/v2",
  APIFY_TOKEN: "platform-token-0000000000000",
  APP_BASE_URL: "http://localhost:3000",
  KEY_ENCRYPTION_SECRET: "e2e-encryption-secret-".padEnd(48, "k"),
  WEBHOOK_SECRET: "e2e-signing-secret-0123456789abcdef",
  CRON_SECRET: "e2e-cron-secret",
  ADMIN_EMAILS: "",
  // Pin every tuning knob so results do not depend on a developer's .env.
  APIFY_ACTOR: "lowcost",
  HOT_WINDOW_DAYS: "2",
  HOT_LIMIT: "8",
  WARM_WINDOW_DAYS: "30",
  WARM_LIMIT: "60",
  WARM_EVERY_HOURS: "168",
  BACKFILL_WINDOW_DAYS: "365",
  BACKFILL_LIMIT: "200",
  OUTLIER_THRESHOLD: "3",
  OUTLIER_MIN_AGE_HOURS: "24",
  OUTLIER_BASELINE_SIZE: "30",
};

const children = [];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function start(args, { cwd = ROOT, label, readyText } = {}) {
  const child = spawn(process.execPath, args, {
    cwd, env: ENV, detached: process.platform !== "win32", stdio: ["ignore", "pipe", "pipe"],
  });
  children.push(child);
  let log = "";
  child.stdout.on("data", (d) => (log += d));
  child.stderr.on("data", (d) => (log += d));
  child.logOf = () => log;
  child.label = label;
  return new Promise((resolve, reject) => {
    child.on("exit", (code) => reject(new Error(`${label} exited early (${code}):\n${log.slice(-800)}`)));
    const t = setInterval(() => {
      if (readyText && log.includes(readyText)) { clearInterval(t); resolve(child); }
    }, 200);
    setTimeout(() => { clearInterval(t); reject(new Error(`${label} not ready in time:\n${log.slice(-800)}`)); }, 120_000);
  });
}

function kill(child) {
  if (!child || child.exitCode !== null) return;
  try {
    if (process.platform === "win32") spawnSync("taskkill", ["/pid", String(child.pid), "/T", "/F"], { stdio: "ignore" });
    else process.kill(-child.pid, "SIGKILL");
  } catch { /* already gone */ }
}

async function resetDb() {
  const c = new Client({ connectionString: DB_URL });
  await c.connect();
  // The schema may not exist on the very first run; seed.mts creates it.
  await c.query("DO $$ BEGIN IF to_regclass('public.users') IS NOT NULL THEN TRUNCATE users, scrape_runs, post_metrics, posts, competitors, alerts, watchlist RESTART IDENTITY CASCADE; END IF; END $$");
  await c.end();
  const seed = spawnSync(process.execPath, ["--import", "tsx", path.join(E2E, "seed.mts")], { cwd: ROOT, env: ENV, encoding: "utf8" });
  if (seed.status !== 0) throw new Error("seed failed:\n" + (seed.stdout + seed.stderr).slice(-800));
}

async function waitForApp() {
  for (let i = 0; i < 120; i++) {
    try { if ((await fetch("http://localhost:3000/login")).status === 200) return; } catch { /* not yet */ }
    await sleep(1000);
  }
  throw new Error("app did not start");
}

let fakeProc = null;
async function freshFake() {
  kill(fakeProc);
  await sleep(500);
  fakeProc = await start([path.join(E2E, "fake-collector.mjs")], { cwd: E2E, label: "fake collector", readyText: "fake collector on" });
}

const results = [];
try {
  console.log("starting throwaway Postgres...");
  await start([path.join(E2E, "pg-start.mjs")], { label: "postgres", readyText: "READY" });
  await freshFake();
  await resetDb();

  console.log("starting the app...");
  await start([require.resolve("next/dist/bin/next"), "dev", "-p", "3000"], { label: "app", readyText: "Ready in" });
  await waitForApp();

  for (const suite of SUITES) {
    console.log(`\n=== ${suite} ===`);
    await freshFake();
    await resetDb();
    await sleep(1500);
    const code = await new Promise((resolve) => {
      const p = spawn(process.execPath, [path.join(E2E, suite)], { cwd: ROOT, env: ENV, stdio: "inherit" });
      p.on("exit", (c) => resolve(c ?? 1));
    });
    results.push([suite, code]);
  }
} catch (err) {
  console.error("\nharness error:", err instanceof Error ? err.message : err);
  results.push(["harness", 1]);
} finally {
  for (const c of children) kill(c);
}

console.log("\n==== summary ====");
for (const [name, code] of results) console.log(`${code === 0 ? "PASS" : "FAIL"}  ${name}`);
process.exit(results.every(([, c]) => c === 0) ? 0 : 1);
