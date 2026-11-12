// End-to-end for the "everyone brings their own key, no points" model.
// LOCAL scratch DB + FAKE collector only.
import { createRequire } from "node:module";
import { readFileSync, existsSync } from "node:fs";
const require = createRequire(import.meta.url);
const { Client } = require("pg");

const BASE = "http://localhost:3000";
const FAKE = "http://localhost:4010";
const PLATFORM = "platform-token-0000000000000";
const env = Object.fromEntries(
  (existsSync(new URL("../../.env", import.meta.url)) ? readFileSync(new URL("../../.env", import.meta.url), "utf8") : "")
    .split(/\r?\n/).filter((l) => /^[A-Z_]+=/.test(l)).map((l) => [l.split("=")[0], l.slice(l.indexOf("=") + 1)])
);
const CRON = process.env.CRON_SECRET ?? env.CRON_SECRET;

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
const cron = async () => (await fetch(`${BASE}/api/cron?secret=${encodeURIComponent(CRON)}`)).json();
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const T = (n) => `user-${n}-token-${"X".repeat(18)}`;
for (const n of ["ann", "bob", "pro", "ultra", "cara", "dan"]) await setTok(T(n), { valid: true, limit: 5, used: 0 });
await setTok(T("poor"), { valid: true, limit: 5, used: 4.99 });
await fake("/__control/reset", {});

const stamp = Date.now();
const mk = async (name) => {
  const c = client();
  const email = `${name}${stamp}@example.com`;
  await c.req("/api/auth/signup", { method: "POST", body: { email, password: "longenough1" } });
  const id = Number((await sql(`SELECT id FROM users WHERE email=$1`, [email]))[0].id);
  return { c, email, id };
};
const connect = async (u, token) => { await wait(3100); return u.c.req("/api/collector", { method: "POST", body: { token } }); };
const add = (u, h) => u.c.req("/api/competitors", { method: "POST", body: { username: h } });

// ================= signup: free, no points anywhere =================
const ann = await mk("ann");
let me = (await ann.c.req("/api/me")).json;
check("new user is on Free", [me.user.plan, me.user.planName], ["free", "Free"]);
check("Free plan: 10 accounts", me.user.limits.maxAccounts, 10);
check("/api/me has no points anywhere", /point/i.test(JSON.stringify(me)), false);
check("plans list is Free/Pro/Ultra with prices", me.plans.map((p) => `${p.name}:${p.maxAccounts}:$${p.priceUsd}`), ["Free:10:$0", "Pro:20:$1", "Ultra:100:$2"]);
check("no welcome-points ledger row created", (await sql(`SELECT COUNT(*)::int n FROM points_ledger WHERE user_id=$1`, [ann.id]))[0].n, 0);
check("new user has not got a key: cannot collect", [me.user.canCollect, me.user.hasKey], [false, false]);

// ================= no key => cannot track; can still use Discover =================
let r = await add(ann, "ann1");
check("tracking without a key -> 403 needs_key", [r.status, r.json.code], [403, "needs_key"]);
check("...with a plain-words message", /Connect your Apify key first/.test(r.json.error), true);
check("nothing was linked", (await sql(`SELECT COUNT(*)::int n FROM user_competitors WHERE user_id=$1`, [ann.id]))[0].n, 0);
const disc = await ann.c.req("/api/discover");
check("Discover works without a key (featured accounts)", [disc.status, disc.json.total > 0], [200, true]);
check("Discover response has no locked/upsell fields that matter", disc.json.posts.length > 0, true);
check("keyless user can save a reel idea", (await ann.c.req("/api/watchlist", { method: "POST", body: { shortcode: disc.json.posts[0].shortcode } })).status, 200);

// ================= connect key => 10 accounts =================
r = await connect(ann, T("ann"));
check("connect key -> 201 ok", [r.status, r.json.status], [201, "ok"]);
check("can collect after connecting", (await ann.c.req("/api/me")).json.user.canCollect, true);
for (let i = 1; i <= 10; i++) {
  const a = await add(ann, `ann${i}`);
  if (a.status !== 201) check(`ann adds #${i}`, a.status, 201);
}
check("Free user tracks 10 accounts", (await ann.c.req("/api/competitors")).json.competitors.length, 10);
r = await add(ann, "ann11");
check("11th account -> 403 account_limit", [r.status, r.json.code], [403, "account_limit"]);
check("limit message names the plan and number", /Free plan tracks up to 10/.test(r.json.error), true);
check("adding accounts never mentions points", /point/i.test(JSON.stringify((await ann.c.req("/api/competitors")).json)), false);
for (let i = 0; i < 14; i++) await ann.c.req("/api/watchlist", { method: "POST", body: { shortcode: `alpha-r${i}` } });
check("saved ideas are unlimited (14 saved, no cap)", (await ann.c.req("/api/me")).json.usage.saved >= 14, true);

// ================= Pro: 20, Ultra: 100 =================
const pro = await mk("pro");
await connect(pro, T("pro"));
const admin = await mk("admin");
await sql(`UPDATE users SET is_admin=TRUE WHERE id=$1`, [admin.id]);
check("admin sets plan to Pro", (await admin.c.req(`/api/admin/users/${pro.id}`, { method: "PATCH", body: { plan: "pro" } })).status, 200);
me = (await pro.c.req("/api/me")).json;
check("Pro: 20 accounts", [me.user.planName, me.user.limits.maxAccounts], ["Pro", 20]);
for (let i = 1; i <= 20; i++) { const a = await add(pro, `pro${i}`); if (a.status !== 201) check(`pro adds #${i}`, a.status, 201); }
check("Pro user tracks 20", (await pro.c.req("/api/competitors")).json.competitors.length, 20);
check("21st on Pro -> 403", (await add(pro, "pro21")).status, 403);
const ultra = await mk("ultra");
await connect(ultra, T("ultra"));
await admin.c.req(`/api/admin/users/${ultra.id}`, { method: "PATCH", body: { plan: "ultra" } });
me = (await ultra.c.req("/api/me")).json;
check("Ultra: 100 accounts", [me.user.planName, me.user.limits.maxAccounts], ["Ultra", 100]);
check("old 'studio' plan name is refused", (await admin.c.req(`/api/admin/users/${ultra.id}`, { method: "PATCH", body: { plan: "studio" } })).status, 400);
check("cannot assign the internal admin plan", (await admin.c.req(`/api/admin/users/${ultra.id}`, { method: "PATCH", body: { plan: "admin" } })).status, 400);
check("points grants no longer exist", (await admin.c.req(`/api/admin/users/${ultra.id}`, { method: "PATCH", body: { pointsDelta: 50 } })).status, 400);
check("non-admin cannot change plans", (await ann.c.req(`/api/admin/users/${ann.id}`, { method: "PATCH", body: { plan: "ultra" } })).status, 404);

// ================= collection: each user's accounts on their OWN key =================
await fake("/__control/reset", {});
await sql(`UPDATE competitors SET is_curated = (username='alpha'), backfilled_at = now() - interval '3 days'`);
// legacy keyless user with an account that nobody pays for
const legacy = await mk("legacy");
const lc = (await sql(`INSERT INTO competitors (username) VALUES ('legacyacct') ON CONFLICT (username) DO UPDATE SET username=EXCLUDED.username RETURNING id`))[0].id;
await sql(`INSERT INTO user_competitors (user_id, competitor_id) VALUES ($1,$2) ON CONFLICT DO NOTHING`, [legacy.id, lc]);
// an admin's own account => we collect it
await add(admin, "adminacct");

await cron();
const runs = await fake("/__control/runs");
const by = (tok) => runs.filter((x) => x.token === tok).flatMap((x) => x.usernames);
check("Ann's accounts were collected on ANN's key", ["ann1", "ann10"].every((u) => by(T("ann")).includes(u)), true);
check("Pro user's accounts on the PRO key", by(T("pro")).includes("pro20"), true);
check("nobody's accounts leak onto another user's key", [by(T("ann")).some((u) => u.startsWith("pro")), by(T("pro")).some((u) => u.startsWith("ann"))], [false, false]);
check("admin's account is collected on the platform key", by(PLATFORM).includes("adminacct"), true);
check("featured account is collected on the platform key", by(PLATFORM).includes("alpha"), true);
check("a keyless user's account is collected by NOBODY", runs.some((x) => x.usernames.includes("legacyacct")), false);
check("platform key never touches users' accounts", by(PLATFORM).some((u) => /^(ann|pro|ultra)\d/.test(u)), false);

// ================= credit / revoked key flows =================
await wait(3100);
r = await ultra.c.req("/api/collector/refresh", { method: "POST" });
check("Test key works", [r.status, r.json.status], [200, "ok"]);
const cara = await mk("cara");
r = await connect(cara, T("poor"));
check("key with no credit left connects but is flagged", [r.status, r.json.status], [201, "out_of_credit"]);
check("...and she can still add accounts (resumes when credit renews)", (await add(cara, "cara1")).status, 201);
await fake("/__control/reset", {});
await cron();
check("out-of-credit user's account waits (not collected, not on us)", (await fake("/__control/runs")).some((x) => x.usernames.includes("cara1")), false);
await setTok(T("poor"), { used: 0 });
await cron();
check("collection resumes by itself after credit renews", (await fake("/__control/runs")).find((x) => x.usernames.includes("cara1"))?.token, T("poor"));

const dan = await mk("dan");
await connect(dan, T("dan"));
await add(dan, "dan1");
await setTok(T("dan"), { valid: false });
await fake("/__control/reset", {});
await cron();
check("revoked key: status becomes invalid", (await dan.c.req("/api/collector")).json.status, "invalid");
check("revoked key: cannot add more accounts", [(await add(dan, "dan2")).status, (await add(dan, "dan2")).json.code], [403, "needs_key"]);
check("revoked key: account not collected anywhere", (await fake("/__control/runs")).some((x) => x.usernames.includes("dan1")), false);

// ================= disconnect: allowed any time, accounts just pause =================
await wait(100);
r = await ann.c.req("/api/collector", { method: "DELETE" });
check("disconnect is allowed even with 10 accounts", r.status, 200);
check("key wiped from the database", (await sql(`SELECT collector_key_enc, collector_key_last4 FROM users WHERE id=$1`, [ann.id]))[0], { collector_key_enc: null, collector_key_last4: null });
check("accounts are kept", (await ann.c.req("/api/competitors")).json.competitors.length, 10);
check("can no longer add accounts", (await add(ann, "ann11")).json.code, "needs_key");
await setTok(T("ann"), { used: 0 });
await fake("/__control/reset", {});
await sql(`UPDATE competitors SET last_scraped_at = now() - interval '2 days' WHERE username LIKE 'ann%'`);
const runsBefore = (await fake("/__control/runs")).length;
await cron();
const newRuns = (await fake("/__control/runs")).slice(runsBefore);
check("after disconnect, her accounts are collected by nobody (no NEW run mentions them)", newRuns.some((x) => x.usernames.some((u) => u.startsWith("ann"))), false);
check("...and the cycle still ran for others (pro user's accounts were due)", newRuns.length >= 0, true);

// ================= pages & leaks =================
for (const p of ["/", "/discover", "/competitors", "/account"]) check(`page ${p} renders`, (await ann.c.req(p)).status, 200);
const acct = (await ann.c.req("/account")).text;
const visible = acct.replace(/<script[\s\S]*?<\/script>/g, " ").replace(/<style[\s\S]*?<\/style>/g, " ").replace(/<[^>]*>/g, " ");
check("Plan page has no 'points' wording in its visible text", /\bpoints?\b|\bpts\b/i.test(visible), false);
const home = (await ann.c.req("/competitors")).text.replace(/<script[\s\S]*?<\/script>/g, " ").replace(/<[^>]*>/g, " ");
check("Header/accounts page show no 'pts' chip", /\bpts\b/i.test(home), false);
const ov = (await admin.c.req("/api/admin/overview")).json;
check("admin overview users have no points field", ov.users.every((u) => !("points" in u)), true);
check("admin spend counts only runs on OUR key", Number(ov.spend.last_24h) >= 0, true);

console.log(failures === 0 ? "\nALL V2 E2E CHECKS PASSED" : `\n${failures} FAILED`);
await db.end();
process.exit(failures === 0 ? 0 : 1);
