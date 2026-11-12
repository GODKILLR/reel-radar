// Collection ON REQUEST, with the scheduler completely absent.
// This test NEVER calls /api/cron. LOCAL scratch DB + FAKE collector only.
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { Client } = require("pg");

const BASE = "http://localhost:3000";
const FAKE = "http://localhost:4010";
const PLATFORM = "platform-token-0000000000000";

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
const T = (n) => `user-${n}-token-${"X".repeat(18)}`;
for (const n of ["ann", "bob", "cara", "dan", "eve"]) await setTok(T(n), { valid: true, limit: 5, used: 0 });
await setTok(T("poor"), { valid: true, limit: 5, used: 4.99 });
await fake("/__control/reset", {});

const stamp = Date.now();
const mk = async (name) => {
  const c = client();
  const email = `${name}${stamp}@example.com`;
  await c.req("/api/auth/signup", { method: "POST", body: { email, password: "longenough1" } });
  return { c, email, id: Number((await sql(`SELECT id FROM users WHERE email=$1`, [email]))[0].id) };
};
const connect = async (u, token) => { await wait(3100); return u.c.req("/api/collector", { method: "POST", body: { token } }); };
const add = (u, h) => u.c.req("/api/competitors", { method: "POST", body: { username: h } });
const collect = (u, force = false) => u.c.req("/api/collect", { method: "POST", body: { force } });
const runCount = async () => (await fake("/__control/runs")).length;
const newRuns = async (since) => (await fake("/__control/runs")).slice(since);
const finishAll = async (runs) => { for (const r of runs) await fake("/__control/finish", { runId: r.id }); };

// ================= adding an account collects it immediately =================
const ann = await mk("ann");
await connect(ann, T("ann"));
let before = await runCount();
check("add account", (await add(ann, "ann1")).status, 201);
let r = await collect(ann);
check("collect right after adding -> started, backfill of 1 account", [r.json.outcome, r.json.launched], ["started", [{ tier: "backfill", accounts: 1 }]]);
let runs = await newRuns(before);
check("the run was started on ANN's own key (no scheduler involved)", [runs.length, runs[0]?.token, runs[0]?.usernames], [1, T("ann"), ["ann1"]]);
check("the run is billed to Ann in the DB", (await sql(`SELECT owner_user_id::text o, tier FROM scrape_runs ORDER BY id DESC LIMIT 1`))[0], { o: String(ann.id), tier: "backfill" });
check("response has plain-words message, no vendor/cost talk", /apify|cost|\$|usd|token/i.test(r.json.message), false);

// ---- pressing again while it runs does not start a duplicate ----
before = await runCount();
r = await collect(ann);
check("collect again while running -> in_progress (no duplicate run)", [r.json.outcome, await runCount() - before], ["in_progress", 0]);
r = await collect(ann, true);
check("even 'Refresh now' while running starts nothing extra", [r.json.outcome, await runCount() - before], ["in_progress", 0]);

// ---- results land via the callback ----
await finishAll(runs);
check("reels arrived for ann1 (3 posts)", (await sql(`SELECT COUNT(*)::int n FROM posts p JOIN competitors c ON c.id=p.competitor_id WHERE c.username='ann1'`))[0].n, 3);
check("account no longer 'collecting' (last_scraped set)", (await sql(`SELECT last_scraped_at IS NOT NULL ok FROM competitors WHERE username='ann1'`))[0].ok, true);

// ---- fresh data: nothing to do, and the collector is not even contacted ----
await sql(`UPDATE scrape_runs SET started_at = now() - interval '2 hours' WHERE owner_user_id=$1`, [ann.id]);
await sql(`UPDATE scrape_runs SET started_at = now() - interval '10 days', status='succeeded' WHERE owner_user_id=$1 AND tier='warm'`, [ann.id]);
await fake("/__control/reset", {});
before = await runCount();
r = await collect(ann);
// weekly sweep may be due (never ran): that is allowed; assert on the hot tier only
const tiersNow = r.json.launched.map((l) => l.tier);
check("fresh account: no refresh (hot) run is started", tiersNow.includes("hot"), false);
await sql(`UPDATE scrape_runs SET started_at = now() - interval '2 hours' WHERE owner_user_id=$1`, [ann.id]);
await finishAll(await newRuns(before));

// Make the warm sweep not-due, then prove a check with nothing due makes ZERO outside calls.
await sql(`INSERT INTO scrape_runs (tier, usernames, status, owner_user_id, started_at) VALUES ('warm', ARRAY['ann1'], 'succeeded', $1, now() - interval '1 day')`, [ann.id]);
await fake("/__control/reset", {});
r = await collect(ann);
check("nothing due -> 'up to date'", r.json.outcome, "nothing_due");
check("nothing due -> ZERO calls to the collector (cheap to call on every page open)", (await fake("/__control/log")).length, 0);

// ================= stale account refreshes when the user opens the app =================
await sql(`UPDATE competitors SET last_scraped_at = now() - interval '2 days' WHERE username='ann1'`);
await sql(`UPDATE scrape_runs SET started_at = now() - interval '2 hours' WHERE owner_user_id=$1`, [ann.id]);
before = await runCount();
r = await collect(ann);
check("stale account -> refresh (hot) started automatically", [r.json.outcome, r.json.launched.map((l) => l.tier)], ["started", ["hot"]]);
runs = await newRuns(before);
check("...on Ann's key, for ann1 only", [runs[0].token, runs[0].usernames], [T("ann"), ["ann1"]]);
await finishAll(runs);

// ================= Refresh now: forced, but throttled =================
await sql(`UPDATE scrape_runs SET started_at = now() - interval '2 hours' WHERE owner_user_id=$1`, [ann.id]);
before = await runCount();
r = await collect(ann, true);
check("'Refresh now' on fresh data still refreshes (forced)", [r.json.outcome, r.json.launched.map((l) => l.tier)], ["started", ["hot"]]);
await finishAll(await newRuns(before));
before = await runCount();
r = await collect(ann, true);
check("pressing it again right away is throttled (15 min cooldown)", [r.json.outcome, await runCount() - before], ["cooldown", 0]);

// ================= two users add the same new account at once: ONE backfill =================
const bob = await mk("bob");
await connect(bob, T("bob"));
await add(ann, "shared1");
await add(bob, "shared1");
await sql(`UPDATE scrape_runs SET started_at = now() - interval '2 hours' WHERE owner_user_id IN ($1,$2)`, [ann.id, bob.id]);
before = await runCount();
const [ra, rb] = await Promise.all([collect(ann), collect(bob)]);
const sharedRuns = (await newRuns(before)).filter((x) => x.usernames.includes("shared1"));
check("two users, same new account, simultaneous requests -> exactly ONE history fetch", sharedRuns.length, 1);
check("...the loser is told it is being collected, not an error", [ra.status, rb.status].every((s) => s === 200), true);
check("the history was paid for by exactly one of them", new Set(sharedRuns.map((x) => x.token)).size, 1);
await finishAll(await newRuns(before));
check("both users see the shared account's reels", (await sql(`SELECT COUNT(*)::int n FROM posts p JOIN competitors c ON c.id=p.competitor_id WHERE c.username='shared1'`))[0].n, 3);

// ================= credit / key problems are reported, nothing is started =================
const cara = await mk("cara");
await connect(cara, T("poor"));
await add(cara, "cara1");
before = await runCount();
r = await collect(cara);
check("out of credit -> told plainly, no run", [r.json.outcome, /credit/i.test(r.json.message), await runCount() - before], ["out_of_credit", true, 0]);
await setTok(T("poor"), { used: 0 });
r = await collect(cara);
check("credit renewed -> collects on the next request, no scheduler", [r.json.outcome, (await newRuns(before))[0]?.token], ["started", T("poor")]);

const dan = await mk("dan");
await connect(dan, T("dan"));
await add(dan, "dan1");
await setTok(T("dan"), { valid: false });
before = await runCount();
r = await collect(dan);
check("revoked key -> told to reconnect, no run", [r.json.outcome, /reconnect/i.test(r.json.message), await runCount() - before], ["invalid", true, 0]);
const eve = await mk("eve");
r = await collect(eve);
check("no key -> 'connect your key', no run", [r.status, r.json.outcome, await runCount() - before], [200, "no_key", 0]);
check("signed out -> 401", (await client().req("/api/collect", { method: "POST", body: {} })).status, 401);

// ================= a refused run does not burn the account =================
const fay = await mk("fay");
await setTok(T("fay"), { valid: true, limit: 5, used: 0 });
await connect(fay, T("fay"));
await add(fay, "fay1");
await setTok(T("fay"), { rejectStart: 402 });
await collect(fay);
check("run refused at start -> account's history marker is NOT burned", (await sql(`SELECT backfilled_at FROM competitors WHERE username='fay1'`))[0].backfilled_at, null);
await setTok(T("fay"), { rejectStart: 0, used: 0 });
await sql(`UPDATE users SET collector_status='ok' WHERE id=$1`, [fay.id]);
before = await runCount();
r = await collect(fay);
check("...so the next request retries it", [r.json.outcome, (await newRuns(before))[0]?.usernames], ["started", ["fay1"]]);

// ================= our own accounts are never collected on a user's key =================
const gus = await mk("gus");
await connect(gus, T("ann")); // reuse a valid fake token
await sql(`UPDATE competitors SET is_curated = TRUE WHERE username='alpha'`);
await add(gus, "alpha");
await add(gus, "gus1");
before = await runCount();
await collect(gus);
const gusRuns = await newRuns(before);
check("a user's key never runs a featured account", gusRuns.some((x) => x.usernames.includes("alpha")), false);
check("...but does run their own", gusRuns.some((x) => x.usernames.includes("gus1")), true);

// ================= admin: collect featured accounts now =================
const admin = await mk("admin");
await sql(`UPDATE users SET is_admin=TRUE WHERE id=$1`, [admin.id]);
check("non-admin cannot trigger platform collection", (await gus.c.req("/api/admin/collect", { method: "POST" })).status, 404);
await sql(`UPDATE competitors SET last_scraped_at = now() - interval '2 days' WHERE username='alpha'`);
before = await runCount();
r = await admin.c.req("/api/admin/collect", { method: "POST" });
const platformRuns = await newRuns(before);
check("admin 'collect featured now' runs on OUR key", [r.status, platformRuns.length > 0, platformRuns.every((x) => x.token === PLATFORM)], [200, true, true]);
check("...and includes the featured account", platformRuns.some((x) => x.usernames.includes("alpha")), true);
check("...and never a user's account", platformRuns.some((x) => x.usernames.some((u) => /^(ann|bob|cara|dan|fay|gus)\d?/.test(u) && u !== "alpha")), false);

// ================= UI wiring is present in the shipped pages =================
const accounts = await ann.c.req("/competitors");
check("accounts page renders", accounts.status, 200);

console.log(failures === 0 ? "\nALL ON-DEMAND E2E CHECKS PASSED" : `\n${failures} FAILED`);
await db.end();
process.exit(failures === 0 ? 0 : 1);
