// Accounts whose reels come back with NO views: detect, switch collector, re-collect.
// LOCAL scratch DB + FAKE collector only. Never calls the scheduler.
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { Client } = require("pg");

const BASE = "http://localhost:3000";
const FAKE = "http://localhost:4010";
const PLATFORM = "platform-token-0000000000000";
const CHEAP = "sones~instagram-posts-scraper-lowcost";
const FULL = "apify~instagram-post-scraper";

let failures = 0;
const check = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) failures++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}: ${JSON.stringify(got)}${ok ? "" : `  (expected ${JSON.stringify(want)})`}`);
};
const db = new Client({ connectionString: "postgres://test:test@localhost:5433/rr_test" });
await db.connect();
const sql = async (t, p) => (await db.query(t, p)).rows;

function client() {
  let cookie = "";
  return {
    async req(path, { method = "GET", body } = {}) {
      const res = await fetch(BASE + path, {
        method, redirect: "manual",
        headers: { ...(body ? { "Content-Type": "application/json" } : {}), ...(cookie ? { cookie } : {}) },
        body: body ? JSON.stringify(body) : undefined,
      });
      const set = res.headers.get("set-cookie");
      if (set) { const pair = set.split(";")[0]; cookie = pair.endsWith("=") ? "" : pair; }
      const text = await res.text();
      let json = null; try { json = JSON.parse(text); } catch {}
      return { status: res.status, json, text };
    },
  };
}
const fake = async (path, body) => (await fetch(FAKE + path, { method: body ? "POST" : "GET", headers: { "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined })).json();
const setTok = (token, patch) => fake("/__control/set", { token, patch });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const T = "user-viewsann-token-" + "X".repeat(14);
await setTok(T, { valid: true, limit: 5, used: 0 });
await fake("/__control/reset", {});

const stamp = Date.now();
const mk = async (name) => {
  const c = client();
  const email = `${name}${stamp}@example.com`;
  await c.req("/api/auth/signup", { method: "POST", body: { email, password: "longenough1" } });
  return { c, email, id: Number((await sql(`SELECT id FROM users WHERE email=$1`, [email]))[0].id) };
};
const add = (u, h) => u.c.req("/api/competitors", { method: "POST", body: { username: h } });
const collect = (u, force = false) => u.c.req("/api/collect", { method: "POST", body: { force } });
const allRuns = () => fake("/__control/runs");
const finish = (id) => fake("/__control/finish", { runId: id });

// ================= first collection on the cheap collector =================
const ann = await mk("viewsann");
await wait(3100);
await ann.c.req("/api/collector", { method: "POST", body: { token: T } });
await add(ann, "noviews1");
await add(ann, "okviews1");
let before = (await allRuns()).length;
let r = await collect(ann);
check("collect -> one backfill run for both accounts", [r.json.outcome, r.json.launched], ["started", [{ tier: "backfill", accounts: 2 }]]);
let runs = (await allRuns()).slice(before);
check("it used the CHEAP collector", [runs.length, runs[0].actor], [1, CHEAP]);

// ---- finish: noviews1 comes back with zero views; the app notices ----
before = (await allRuns()).length;
const fin = await finish(runs[0].id);
check("callback accepted", fin.status, 200);
check("the app flagged noviews1 (and only it) as missing views", fin.body.recollecting, ["noviews1"]);
check("noviews1 reels arrived with 0 views (the bug being fixed)", (await sql(`SELECT MAX(views)::int v, COUNT(*)::int n FROM posts p JOIN competitors c ON c.id=p.competitor_id WHERE c.username='noviews1'`))[0], { v: 0, n: 3 });
check("okviews1 got real views from the cheap collector", (await sql(`SELECT MAX(views)::int v FROM posts p JOIN competitors c ON c.id=p.competitor_id WHERE c.username='okviews1'`))[0].v, 3000);
check("noviews1 switched to the fuller collector; okviews1 untouched", (await sql(`SELECT username, views_source FROM competitors WHERE username IN ('noviews1','okviews1') ORDER BY username`)), [{ username: "noviews1", views_source: "official" }, { username: "okviews1", views_source: null }]);

// ---- ...and re-collected automatically, no user action, on the same key ----
runs = (await allRuns()).slice(before);
check("a NEW run started automatically on the user's own key", [runs.length, runs[0]?.token, runs[0]?.usernames], [1, T, ["noviews1"]]);
check("...using the FULLER collector", runs[0]?.actor, FULL);
check("...billed to the user, recorded with its collector", (await sql(`SELECT owner_user_id::text o, adapter, tier FROM scrape_runs ORDER BY id DESC LIMIT 1`))[0], { o: String(ann.id), adapter: "official", tier: "backfill" });

// ---- finishing it fills the views in ----
const fin2 = await finish(runs[0].id);
check("full-collector callback accepted, NOT re-flagged (no loop)", [fin2.status, fin2.body.recollecting], [200, []]);
check("noviews1 now has real views", (await sql(`SELECT MAX(views)::int v, MIN(views)::int mn FROM posts p JOIN competitors c ON c.id=p.competitor_id WHERE c.username='noviews1'`))[0], { v: 3000, mn: 1000 });
check("hidden likes (-1) are stored as 0, never negative", (await sql(`SELECT MIN(likes)::int m FROM posts p JOIN competitors c ON c.id=p.competitor_id WHERE c.username='noviews1'`))[0].m, 0);
check("no negative likes anywhere in the database", (await sql(`SELECT COUNT(*)::int n FROM posts WHERE likes < 0`))[0].n, 0);
check("same 3 posts (upgraded, not duplicated)", (await sql(`SELECT COUNT(*)::int n FROM posts p JOIN competitors c ON c.id=p.competitor_id WHERE c.username='noviews1'`))[0].n, 3);
check("account is 'collected' again", (await sql(`SELECT last_scraped_at IS NOT NULL ok FROM competitors WHERE username='noviews1'`))[0].ok, true);

// ================= later refreshes split by collector =================
await sql(`UPDATE competitors SET last_scraped_at = now() - interval '2 days' WHERE username IN ('noviews1','okviews1')`);
await sql(`UPDATE scrape_runs SET started_at = now() - interval '2 hours' WHERE owner_user_id=$1`, [ann.id]);
await sql(`INSERT INTO scrape_runs (tier, usernames, status, owner_user_id, started_at) VALUES ('warm', ARRAY['okviews1'], 'succeeded', $1, now() - interval '1 day')`, [ann.id]);
before = (await allRuns()).length;
r = await collect(ann);
runs = (await allRuns()).slice(before);
check("refresh -> two runs, one per collector", runs.map((x) => `${x.actor}:${x.usernames.join(",")}`).sort(), [`${FULL}:noviews1`, `${CHEAP}:okviews1`].sort());
check("both on the user's own key", runs.every((x) => x.token === T), true);
for (const x of runs) await finish(x.id);

// ================= self-heal for data collected before this fix =================
await sql(`INSERT INTO competitors (username, backfilled_at, last_scraped_at) VALUES ('zeros1', now(), now()), ('zeros2', now(), now()), ('fine1', now(), now())`);
for (const [u, n, v] of [["zeros1", 4, 0], ["zeros2", 2, 0], ["fine1", 4, 50]]) {
  for (let i = 0; i < n; i++) await sql(`INSERT INTO posts (shortcode, competitor_id, is_reel, posted_at, views) SELECT $1, id, TRUE, now() - interval '5 days', $3 FROM competitors WHERE username=$2`, [`${u}-${i}`, u, v]);
}
await sql(`UPDATE competitors SET views_source=NULL WHERE username IN ('zeros1','zeros2','fine1')`);
// run the schema through the real migrate() (same code as `npm run migrate`)
const { execFileSync } = await import("node:child_process");
const { fileURLToPath } = await import("node:url");
const REPO = fileURLToPath(new URL("../..", import.meta.url));
const MIGRATE = fileURLToPath(new URL("./migrate-only.mts", import.meta.url));
const runMigrate = () => execFileSync("node", ["--import", "tsx", MIGRATE], { cwd: REPO, env: { ...process.env, DATABASE_URL: "postgres://test:test@localhost:5433/rr_test" }, stdio: "pipe" });
runMigrate();
const healed = await sql(`SELECT username, views_source, backfilled_at IS NULL AS reset FROM competitors WHERE username IN ('zeros1','zeros2','fine1') ORDER BY username`);
check("self-heal: 4 reels / zero views -> switched and queued for re-collection", healed.find((x) => x.username === "zeros1"), { username: "zeros1", views_source: "official", reset: true });
check("self-heal: only 2 reels -> left alone (not enough to judge)", healed.find((x) => x.username === "zeros2"), { username: "zeros2", views_source: null, reset: false });
check("self-heal: account with views -> left alone", healed.find((x) => x.username === "fine1"), { username: "fine1", views_source: null, reset: false });
runMigrate();
check("self-heal is idempotent (second migrate changes nothing more)", (await sql(`SELECT COUNT(*)::int n FROM competitors WHERE views_source='official'`))[0].n, 2);

// ================= our own (platform) accounts get the same treatment =================
const admin = await mk("viewsadmin");
await sql(`UPDATE users SET is_admin=TRUE WHERE id=$1`, [admin.id]);
await add(admin, "noviewsadmin");
before = (await allRuns()).length;
await admin.c.req("/api/admin/collect", { method: "POST" });
runs = (await allRuns()).slice(before);
const platRun = runs.find((x) => x.usernames.includes("noviewsadmin"));
check("admin account first collected on OUR key with the cheap collector", [platRun?.token, platRun?.actor], [PLATFORM, CHEAP]);
before = (await allRuns()).length;
const fin3 = await finish(platRun.id);
check("flagged for missing views", fin3.body.recollecting, ["noviewsadmin"]);
runs = (await allRuns()).slice(before);
check("re-collected automatically on OUR key with the fuller collector (never a user's key)", [runs[0]?.token, runs[0]?.actor, runs[0]?.usernames], [PLATFORM, FULL, ["noviewsadmin"]]);

// ================= pages =================
check("feed API returns real views for the fixed account", (await ann.c.req("/api/posts?competitorId=" + (await sql(`SELECT id FROM competitors WHERE username='noviews1'`))[0].id)).json.posts.every((p) => Number(p.views) > 0), true);

console.log(failures === 0 ? "\nALL VIEWS E2E CHECKS PASSED" : `\n${failures} FAILED`);
await db.end();
process.exit(failures === 0 ? 0 : 1);
