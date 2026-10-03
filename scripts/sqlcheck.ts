/**
 * End-to-end exercise of every SQL path against the real database.
 * Creates throwaway data under a __sqlcheck_ prefix and removes it at the end.
 */
import { query, queryOne } from "../src/lib/db";
import { ingestPosts, recomputeDerived } from "../src/lib/ingest";
import { dispatchOutlierAlerts } from "../src/lib/alerts";
import type { NormalizedPost } from "../src/lib/apify";

const USER = "__sqlcheck_acct";
let failures = 0;

function check(name: string, got: unknown, want: unknown) {
  const ok = String(got) === String(want);
  if (!ok) failures++;
  console.log(
    `${ok ? "PASS" : "FAIL"}  ${name}: ${got}${ok ? "" : ` (expected ${want})`}`
  );
}

function makePost(
  shortcode: string,
  views: number,
  ageHours: number,
  extra: Partial<NormalizedPost> = {}
): NormalizedPost {
  return {
    shortcode,
    username: USER,
    postType: "Video",
    productType: "clips",
    isReel: true,
    url: `https://www.instagram.com/reel/${shortcode}/`,
    caption: `caption for ${shortcode} #tag1 #tag2`,
    hashtags: ["tag1", "tag2"],
    mentions: ["someone"],
    thumbnailUrl: "https://x.fbcdn.net/t.jpg",
    videoUrl: "https://x.fbcdn.net/v.mp4",
    durationSec: 11.7,
    postedAt: new Date(Date.now() - ageHours * 3_600_000),
    views,
    reach: Math.round(views / 3),
    likes: Math.round(views / 20),
    comments: Math.round(views / 500),
    isPaidPartnership: false,
    audioId: "audio_abc",
    audioSong: "Original audio",
    audioArtist: USER,
    audioIsOriginal: true,
    ownerFullName: "SQL Check Account",
    ownerProfilePic: "https://x.cdninstagram.com/pp.jpg",
    ...extra,
  };
}

async function cleanup() {
  // Avoid LIKE here: underscore is a single-character wildcard, and the
  // backslash escape for it gets stripped by JS string parsing before
  // Postgres ever sees it. A prefix comparison has no such trap.
  await query(`DELETE FROM competitors WHERE left(username, 11) = $1`, [
    "__sqlcheck_",
  ]);
}

async function main() {
  await cleanup();

  // ---- schema shape ----
  const tables = await query<{ table_name: string }>(
    `SELECT table_name FROM information_schema.tables
     WHERE table_schema = 'public' ORDER BY table_name`
  );
  check(
    "tables created",
    tables.map((t) => t.table_name).join(","),
    "alerts,competitors,post_metrics,posts,scrape_runs,watchlist"
  );

  // ---- competitor insert ----
  const comp = await queryOne<{ id: number }>(
    `INSERT INTO competitors (username) VALUES ($1) RETURNING id`,
    [USER]
  );
  const cid = comp!.id;

  // ---- bulk ingest ----
  // 11 mature baseline reels at 10k views -> median 10k. One at 60k (6x, "hot"),
  // one at 35k (3.5x, "warm"), one very new that must stay unscored.
  const baseline = Array.from({ length: 11 }, (_, i) =>
    makePost(`__base${i}`, 10_000, 100 + i)
  );
  const viral = makePost("__viral", 60_000, 72);
  const mid = makePost("__mid", 35_000, 50);
  const fresh = makePost("__fresh", 999_999, 2); // 2h old: too immature to score
  const photo = makePost("__photo", 0, 80, {
    isReel: false,
    productType: "feed",
    postType: "Image",
    audioId: null,
    audioSong: null,
    hashtags: [],
    mentions: [],
  });

  const r1 = await ingestPosts([...baseline, viral, mid, fresh, photo]);
  check("ingest seen", r1.seen, 15);
  check("ingest inserted", r1.inserted, 15);
  check("ingest updated", r1.updated, 0);
  check("unknown accounts skipped", r1.skippedUnknownAccount.length, 0);

  // ---- hashtag / mention round trip through string_to_array ----
  const tags = await queryOne<{ h: string[]; m: string[] }>(
    `SELECT hashtags AS h, mentions AS m FROM posts WHERE shortcode = '__viral'`
  );
  check("hashtags round trip", JSON.stringify(tags!.h), '["tag1","tag2"]');
  check("mentions round trip", JSON.stringify(tags!.m), '["someone"]');
  const empty = await queryOne<{ h: string[] }>(
    `SELECT hashtags AS h FROM posts WHERE shortcode = '__photo'`
  );
  check("empty hashtags -> empty array", JSON.stringify(empty!.h), "[]");

  // ---- derived: median + outlier scores ----
  const med = await queryOne<{ median_views: string; post_count: number }>(
    `SELECT median_views, post_count FROM competitors WHERE id = $1`,
    [cid]
  );
  check("median views (reels only, mature only)", med!.median_views, 10000);
  check("post_count", med!.post_count, 15);

  const scores = await query<{ shortcode: string; outlier_score: string | null }>(
    `SELECT shortcode, outlier_score FROM posts
     WHERE shortcode IN ('__viral','__mid','__fresh','__base0')
     ORDER BY shortcode`
  );
  const byCode = Object.fromEntries(
    scores.map((s) => [s.shortcode, s.outlier_score])
  );
  check("baseline post scores 1x", byCode.__base0, "1.00");
  check("mid post scores 3.5x", byCode.__mid, "3.50");
  check("viral post scores 6x", byCode.__viral, "6.00");
  check("immature post left unscored", byCode.__fresh, null);

  // ---- monotonic counters: a scrape that regresses must not lower stored views ----
  const r2 = await ingestPosts([
    makePost("__viral", 10, 72), // bogus low reading
    makePost("__mid", 40_000, 50), // genuine growth
  ]);
  check("re-ingest counts as update", r2.updated, 2);
  check("re-ingest inserted none", r2.inserted, 0);
  const viralViews = await queryOne<{ views: string }>(
    `SELECT views FROM posts WHERE shortcode = '__viral'`
  );
  check("regression clamped by GREATEST", viralViews!.views, 60000);
  const midViews = await queryOne<{ views: string }>(
    `SELECT views FROM posts WHERE shortcode = '__mid'`
  );
  check("genuine growth applied", midViews!.views, 40000);

  // ---- velocity ----
  // Snapshots are written in the same second here, so backdate the older one
  // to simulate a real 2-hour poll gap, then recompute.
  const snaps = await queryOne<{ n: string }>(
    `SELECT COUNT(*)::text AS n FROM post_metrics WHERE shortcode = '__mid'`
  );
  check("two snapshots recorded for __mid", snaps!.n, 2);
  await query(
    `UPDATE post_metrics SET captured_at = now() - interval '2 hours'
     WHERE shortcode = '__mid'
       AND id = (SELECT MIN(id) FROM post_metrics WHERE shortcode = '__mid')`
  );
  await recomputeDerived([cid]);
  const vel = await queryOne<{ views_per_hour: string | null }>(
    `SELECT views_per_hour FROM posts WHERE shortcode = '__mid'`
  );
  // 35k -> 40k over ~2h = ~2500/hr. The gap is 2h minus however long this test
  // took between the two ingests, so assert a band rather than an exact value.
  const vph = Number(vel!.views_per_hour);
  check(
    `views_per_hour computed (~2500, got ${vph})`,
    vph > 2480 && vph < 2520,
    true
  );

  const velViral = await queryOne<{ views_per_hour: string | null }>(
    `SELECT views_per_hour FROM posts WHERE shortcode = '__viral'`
  );
  check("clamped regression gives 0/hr, not negative", velViral!.views_per_hour, "0.0");

  // ---- feed query: every sort and filter ----
  const { GET } = await import("../src/app/api/posts/route");
  for (const sort of [
    "recent",
    "oldest",
    "views",
    "velocity",
    "outlier",
    "likes",
    "engagement",
  ]) {
    const res = await GET(
      new Request(`http://local/api/posts?sort=${sort}&limit=5`) as never
    );
    const body = (await res.json()) as { posts: unknown[]; total: number };
    check(`sort=${sort} returns rows`, body.posts.length > 0, true);
  }

  const outliersRes = await GET(
    new Request(
      `http://local/api/posts?outliersOnly=1&sort=outlier&competitorId=${cid}`
    ) as never
  );
  const outliers = (await outliersRes.json()) as {
    posts: { shortcode: string }[];
  };
  check(
    "outliersOnly returns exactly the 2 flagged reels",
    outliers.posts.map((p) => p.shortcode).join(","),
    "__viral,__mid"
  );

  const daysRes = await GET(
    new Request(`http://local/api/posts?days=3&competitorId=${cid}`) as never
  );
  const days = (await daysRes.json()) as { total: number };
  check("days filter (interval cast works)", days.total > 0, true);

  const reelsRes = await GET(
    new Request(`http://local/api/posts?type=reels&competitorId=${cid}`) as never
  );
  const reels = (await reelsRes.json()) as { total: number };
  check("reels filter excludes the photo", reels.total, 14);

  const audioRes = await GET(
    new Request(
      `http://local/api/posts?audioId=audio_abc&competitorId=${cid}`
    ) as never
  );
  const audio = (await audioRes.json()) as { total: number };
  check("audioId filter", audio.total, 14);

  const qRes = await GET(
    new Request(`http://local/api/posts?q=__viral&competitorId=${cid}`) as never
  );
  const q = (await qRes.json()) as { total: number };
  check("caption search", q.total, 1);

  // ---- watchlist ----
  await query(
    `INSERT INTO watchlist (shortcode, status) VALUES ('__viral','idea')`
  );
  const wlRes = await GET(
    new Request(
      `http://local/api/posts?watchlistOnly=1&competitorId=${cid}`
    ) as never
  );
  const wl = (await wlRes.json()) as {
    total: number;
    posts: { is_watchlisted: boolean; watchlist_status: string }[];
  };
  check("watchlistOnly total", wl.total, 1);
  check("is_watchlisted flag", wl.posts[0].is_watchlisted, true);
  check("watchlist_status joined", wl.posts[0].watchlist_status, "idea");

  // ---- alerts: claim once, dedupe thereafter ----
  const a1 = await dispatchOutlierAlerts({ silent: true });
  check("first pass claims both outliers", a1.claimed, 2);
  check("silent mode sends nothing", a1.notified, 0);
  const a2 = await dispatchOutlierAlerts({ silent: true });
  check("second pass claims nothing (dedupe)", a2.claimed, 0);

  // ---- competitors list route ----
  const compRoute = await import("../src/app/api/competitors/route");
  const cRes = await compRoute.GET();
  const cBody = (await cRes.json()) as {
    competitors: { username: string; outliers_last_30d: string; display_name: string }[];
  };
  const mine = cBody.competitors.find((c) => c.username === USER)!;
  check("competitors route outlier count", mine.outliers_last_30d, 2);
  check("display_name set from ownerFullName", mine.display_name, "SQL Check Account");

  // ---- stats route ----
  const statsRoute = await import("../src/app/api/stats/route");
  const sRes = await statsRoute.GET();
  const sBody = (await sRes.json()) as {
    summary: { total_posts: string } | null;
  };
  check("stats route responds", Number(sBody.summary!.total_posts) >= 15, true);

  // ---- scrape_runs (text[] param binding) ----
  await query(
    `INSERT INTO scrape_runs (apify_run_id, tier, usernames, status)
     VALUES ($1,$2,$3,'started')`,
    ["__sqlcheck_run", "hot", [USER, "other"]]
  );
  const run = await queryOne<{ usernames: string[] }>(
    `SELECT usernames FROM scrape_runs WHERE apify_run_id = '__sqlcheck_run'`
  );
  check("text[] param binding", JSON.stringify(run!.usernames), `["${USER}","other"]`);
  await query(`DELETE FROM scrape_runs WHERE apify_run_id = '__sqlcheck_run'`);

  // ---- cascade delete ----
  await query(`DELETE FROM competitors WHERE id = $1`, [cid]);
  const left = await queryOne<{ n: string }>(
    `SELECT (
       (SELECT COUNT(*) FROM posts WHERE competitor_id = $1) +
       (SELECT COUNT(*) FROM post_metrics WHERE left(shortcode,2) = '__') +
       (SELECT COUNT(*) FROM watchlist WHERE left(shortcode,2) = '__') +
       (SELECT COUNT(*) FROM alerts WHERE left(shortcode,2) = '__')
     )::text AS n`,
    [cid]
  );
  check("cascade removed posts/metrics/watchlist/alerts", left!.n, 0);

  await cleanup();
  console.log(
    failures === 0
      ? "\nAll SQL checks passed."
      : `\n${failures} SQL CHECK(S) FAILED`
  );
  process.exit(failures === 0 ? 0 : 1);
}

main().catch(async (err) => {
  console.error("\nSQL check threw:", err);
  await cleanup().catch(() => {});
  process.exit(1);
});
