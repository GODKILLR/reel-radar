// Keeping the database small: plan depth, snapshot history, no stored video links,
// the "only delete when the database is filling up" rule, orphaned accounts,
// inactive users, last-seen tracking. LOCAL scratch DB + FAKE collector only.
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { Client } = require("pg");

const BASE = "http://localhost:3000";
const FAKE = "http://localhost:4010";
const CRON = "e2e-cron-secret";

let failures = 0;
const check = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) failures++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}: ${JSON.stringify(got)}${ok ? "" : `  (expected ${JSON.stringify(want)})`}`);
};
const db = new Client({ connectionString: "postgres://test:test@localhost:5433/rr_test" });
await db.connect();
const sql = async (t, p) => (await db.query(t, p)).rows;
const n = async (t, p) => Number((await sql(t, p))[0].n);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

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
const cleanup = async (deleting) =>
  (await (await fetch(`${BASE}/api/cron?secret=${CRON}&cleanup=now&only=1&deleting=${deleting ? 1 : 0}`)).json()).cleanup;

const stamp = Date.now();
const mk = async (name) => {
  const c = client();
  const email = `${name}${stamp}@example.com`;
  await c.req("/api/auth/signup", { method: "POST", body: { email, password: "longenough1" } });
  return { c, email, id: Number((await sql(`SELECT id FROM users WHERE email=$1`, [email]))[0].id) };
};
const addAccount = async (username, curated = false) =>
  Number((await sql(`INSERT INTO competitors (username, backfilled_at, last_scraped_at, is_curated) VALUES ($1, now(), now(), $2) RETURNING id`, [username, curated]))[0].id);
let code = 0;
const addPosts = async (cid, reels, photos, withMetrics = 10) => {
  const ids = [];
  for (let i = 0; i < reels + photos; i++) {
    const sc = `cl${stamp}${cid}x${code++}`;
    ids.push(sc);
    await sql(
      `INSERT INTO posts (shortcode, competitor_id, is_reel, url, caption, thumbnail_url, video_url, posted_at, views)
       VALUES ($1,$2,$3,'https://www.instagram.com/p/x/', $4, 'https://x/t.jpg', 'https://x/v.mp4', now() - ($5 || ' hours')::interval, 1000)`,
      [sc, cid, i < reels, "c".repeat(400), String(i + 1)]
    );
    for (let m = 0; m < withMetrics; m++) {
      await sql(`INSERT INTO post_metrics (shortcode, captured_at, views) VALUES ($1, now() - ($2 || ' hours')::interval, $3)`, [sc, String(m), 1000 - m]);
    }
  }
  return ids; // newest first
};

// ================= plan depth + snapshot history (always runs) =================
const u1 = await mk("cleanup1");
const A = await addAccount(`cleanup_a_${stamp}`);
await sql(`INSERT INTO user_competitors (user_id, competitor_id) VALUES ($1,$2)`, [u1.id, A]);
const aPosts = await addPosts(A, 130, 30);
const oldReel = aPosts[120]; // 121st-newest reel: outside the 100-reel window
await sql(`INSERT INTO user_watchlist (user_id, shortcode) VALUES ($1,$2)`, [u1.id, oldReel]);

let rep = await cleanup(false);
check("clean-up ran and reports the database size", typeof rep.dbMb === "number" && rep.limitMb === 1024, true);
check("not filling up, so NOT in deleting mode", rep.deleting, false);
check("reels trimmed to the plan depth (100) + the one saved idea", await n(`SELECT COUNT(*)::int n FROM posts WHERE competitor_id=$1 AND is_reel`, [A]), 101);
check("the saved reel outside the window is KEPT", await n(`SELECT COUNT(*)::int n FROM posts WHERE shortcode=$1`, [oldReel]), 1);
check("the newest 100 reels are all still there", await n(`SELECT COUNT(*)::int n FROM posts WHERE competitor_id=$1 AND shortcode = ANY($2::text[])`, [A, aPosts.slice(0, 100)]), 100);
check("photos trimmed to 20", await n(`SELECT COUNT(*)::int n FROM posts WHERE competitor_id=$1 AND NOT is_reel`, [A]), 20);
check("post_count matches what is left", (await sql(`SELECT post_count::int c FROM competitors WHERE id=$1`, [A]))[0].c, 121);
check("snapshot history capped (<= 6 per post)", await n(`SELECT COALESCE(MAX(c),0)::int n FROM (SELECT COUNT(*) c FROM post_metrics GROUP BY shortcode) t`), 6);
check("the NEWEST snapshots are the ones kept", await n(`SELECT COUNT(*)::int n FROM post_metrics WHERE shortcode=$1 AND views >= 995`, [aPosts[0]]), 6);
check("trimming reported", rep.postsTrimmed >= 29 + 20 - 1 || rep.postsTrimmed > 0, true);

// ================= accounts nobody tracks =================
const O = await addAccount(`cleanup_orphan_${stamp}`);
await addPosts(O, 4, 1, 2);
const OS = await addAccount(`cleanup_orphan_saved_${stamp}`);
const osPosts = await addPosts(OS, 3, 0, 2);
await sql(`INSERT INTO user_watchlist (user_id, shortcode) VALUES ($1,$2)`, [u1.id, osPosts[0]]);
const F = await addAccount(`cleanup_featured_${stamp}`, true);
await addPosts(F, 3, 0, 2);
const R = await addAccount(`cleanup_retracked_${stamp}`);

rep = await cleanup(false);
check("untracked accounts get their 'nobody tracks this' clock started", await n(`SELECT COUNT(*)::int n FROM competitors WHERE id = ANY($1::int[]) AND orphaned_at IS NOT NULL`, [[O, OS, R]]), 3);
check("a featured (Discover) account is never marked", (await sql(`SELECT orphaned_at FROM competitors WHERE id=$1`, [F]))[0].orphaned_at, null);
check("tracked accounts are not marked", (await sql(`SELECT orphaned_at FROM competitors WHERE id=$1`, [A]))[0].orphaned_at, null);

// age them all past the limit
await sql(`UPDATE competitors SET orphaned_at = now() - interval '31 days' WHERE id = ANY($1::int[])`, [[O, OS, R]]);
await sql(`UPDATE competitors SET orphaned_at = now() - interval '31 days' WHERE id=$1`, [F]);

rep = await cleanup(false);
check("DRY RUN (database not full): reports what is due...", rep.accountsDue >= 1 && rep.accountsDeleted === 0, true);
check("...and deletes nothing", await n(`SELECT COUNT(*)::int n FROM competitors WHERE id = ANY($1::int[])`, [[O, OS, F, R]]), 4);

// someone starts tracking R again before the delete
const u2 = await mk("cleanup2");
await sql(`INSERT INTO user_competitors (user_id, competitor_id) VALUES ($1,$2)`, [u2.id, R]);
rep = await cleanup(false);
check("re-tracked account: the clock resets", (await sql(`SELECT orphaned_at FROM competitors WHERE id=$1`, [R]))[0].orphaned_at, null);
await sql(`UPDATE competitors SET orphaned_at = now() - interval '31 days' WHERE id=$1`, [F]); // featured: must still survive

rep = await cleanup(true);
check("filling up: the long-untracked account is DELETED", await n(`SELECT COUNT(*)::int n FROM competitors WHERE id=$1`, [O]), 0);
check("...with its reels and snapshots", await n(`SELECT COUNT(*)::int n FROM posts WHERE competitor_id=$1`, [O]), 0);
check("an untracked account with a SAVED reel is kept", await n(`SELECT COUNT(*)::int n FROM competitors WHERE id=$1`, [OS]), 1);
check("the saved reel is still there", await n(`SELECT COUNT(*)::int n FROM posts WHERE shortcode=$1`, [osPosts[0]]), 1);
check("a featured account is never deleted, however old", await n(`SELECT COUNT(*)::int n FROM competitors WHERE id=$1`, [F]), 1);
check("a tracked account is never deleted", await n(`SELECT COUNT(*)::int n FROM competitors WHERE id IN ($1,$2)`, [A, R]), 2);
check("deleted exactly the one account", rep.accountsDeleted, 1);

// ================= inactive users =================
const u3 = await mk("cleanup3");
const I = await addAccount(`cleanup_inactive_${stamp}`);
await sql(`INSERT INTO user_competitors (user_id, competitor_id) VALUES ($1,$2)`, [u3.id, I]);
await sql(`INSERT INTO user_competitors (user_id, competitor_id) VALUES ($1,$2)`, [u3.id, A]);
await addPosts(I, 2, 0, 2);
await sql(`INSERT INTO user_watchlist (user_id, shortcode) VALUES ($1,$2)`, [u3.id, aPosts[1]]);
await sql(`UPDATE users SET last_seen_at = now() - interval '100 days' WHERE id=$1`, [u3.id]);

rep = await cleanup(false);
check("DRY RUN: spots the inactive user", rep.inactiveUsers >= 1 && rep.trackingLinksRemoved === 0, true);
check("...and removes nothing", await n(`SELECT COUNT(*)::int n FROM user_competitors WHERE user_id=$1`, [u3.id]), 2);
rep = await cleanup(true);
check("filling up: the inactive user's tracking links are removed", await n(`SELECT COUNT(*)::int n FROM user_competitors WHERE user_id=$1`, [u3.id]), 0);
check("...but the USER stays (email = a lead)", await n(`SELECT COUNT(*)::int n FROM users WHERE id=$1`, [u3.id]), 1);
check("...and their saved idea stays", await n(`SELECT COUNT(*)::int n FROM user_watchlist WHERE user_id=$1`, [u3.id]), 1);
check("an account other users track is untouched", await n(`SELECT COUNT(*)::int n FROM user_competitors WHERE competitor_id=$1`, [A]), 1);
check("an active user's links are untouched", await n(`SELECT COUNT(*)::int n FROM user_competitors WHERE user_id=$1`, [u1.id]), 1);
check("admins are never treated as inactive", await (async () => {
  const adm = await mk("cleanupadm");
  await sql(`UPDATE users SET is_admin = true, last_seen_at = now() - interval '400 days' WHERE id=$1`, [adm.id]);
  await sql(`INSERT INTO user_competitors (user_id, competitor_id) VALUES ($1,$2)`, [adm.id, A]);
  await cleanup(true);
  return await n(`SELECT COUNT(*)::int n FROM user_competitors WHERE user_id=$1`, [adm.id]);
})(), 1);

// ================= last seen =================
await sql(`UPDATE users SET last_seen_at = now() - interval '3 days' WHERE id=$1`, [u2.id]);
await u2.c.req("/api/me");
await wait(1200);
check("using the app refreshes 'last seen'", (await sql(`SELECT last_seen_at > now() - interval '1 minute' ok FROM users WHERE id=$1`, [u2.id]))[0].ok, true);
await u2.c.req("/api/me");
check("a signup starts as 'seen now'", (await sql(`SELECT last_seen_at > now() - interval '10 minutes' ok FROM users WHERE id=$1`, [u1.id]))[0].ok, true);

// ================= the daily guard =================
await sql(`DELETE FROM maintenance WHERE job='cleanup'`);
const first = await (await fetch(`${BASE}/api/cron?secret=${CRON}`)).json();
const second = await (await fetch(`${BASE}/api/cron?secret=${CRON}`)).json();
check("scheduled call: clean-up runs the first time", first.cleanup !== null && typeof first.cleanup?.dbMb === "number", true);
check("...and not again the same day", second.cleanup, null);
check("the run is recorded for the admin page", (await sql(`SELECT report IS NOT NULL ok FROM maintenance WHERE job='cleanup'`))[0].ok, true);
check("cron still requires its secret", (await fetch(`${BASE}/api/cron?cleanup=now&only=1`)).status, 401);

// ================= nothing stored that we decided not to store =================
check("no video links are stored for newly collected reels", await (async () => {
  const T = "user-cleanup-token-" + "X".repeat(14);
  await fetch(FAKE + "/__control/set", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token: T, patch: { valid: true, limit: 5, used: 0 } }) });
  const u = await mk("cleanup4");
  await wait(3100);
  await u.c.req("/api/collector", { method: "POST", body: { token: T } });
  await u.c.req("/api/competitors", { method: "POST", body: { username: "okcleanup1" } });
  await u.c.req("/api/collect", { method: "POST", body: {} });
  const runs = await (await fetch(FAKE + "/__control/runs")).json();
  const mine = runs.filter((r) => r.usernames?.includes("okcleanup1")).pop();
  await fetch(FAKE + "/__control/finish", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ runId: mine.id }) });
  return (await sql(`SELECT COUNT(*)::int total, COUNT(video_url)::int vids FROM posts p JOIN competitors c ON c.id=p.competitor_id WHERE c.username='okcleanup1'`))[0];
})(), { total: 3, vids: 0 });

// ================= admin sees it =================
const adminC = client();
const adminEmail = `cleanupadmin${stamp}@example.com`;
await adminC.req("/api/auth/signup", { method: "POST", body: { email: adminEmail, password: "longenough1" } });
await sql(`UPDATE users SET is_admin=true WHERE email=$1`, [adminEmail]);
const ov = await adminC.req("/api/admin/overview");
check("admin overview shows database size and the last clean-up", [ov.status, typeof ov.json?.storage?.dbMb, ov.json?.storage?.lastReport !== null, ov.json?.storage?.limitMb], [200, "number", true, 1024]);
check("a normal user cannot see it", (await u1.c.req("/api/admin/overview")).status, 404);

console.log(failures === 0 ? "\nALL CLEANUP E2E CHECKS PASSED" : `\n${failures} FAILED`);
await db.end();
process.exit(failures === 0 ? 0 : 1);
