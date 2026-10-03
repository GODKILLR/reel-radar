import { query } from "../src/lib/db";
(async () => {
  const runs = await query<any>(`
    SELECT apify_run_id, tier, status, posts_seen, posts_new, cost_usd,
           to_char(started_at,'HH24:MI:SS') st,
           to_char(finished_at,'HH24:MI:SS') fin,
           EXTRACT(EPOCH FROM (now()-started_at))::int age, error
    FROM scrape_runs ORDER BY started_at DESC LIMIT 6`);
  console.log("RECENT RUNS:");
  if (!runs.length) console.log("  (none)");
  for (const r of runs) {
    console.log(`  ${r.tier.padEnd(9)} ${r.status.padEnd(10)} seen=${String(r.posts_seen).padStart(3)} new=${String(r.posts_new).padStart(3)} $${Number(r.cost_usd).toFixed(4)}  started ${r.age}s ago  finished=${r.fin ?? "-"}  ${r.error ? "ERR: "+r.error.slice(0,80) : ""}`);
  }
  const c = await query<any>(`SELECT username, post_count, to_char(last_scraped_at,'HH24:MI:SS') ls FROM competitors ORDER BY username`);
  console.log("\nCOMPETITORS:");
  for (const r of c) console.log(`  @${r.username}  posts=${r.post_count}  last_scraped=${r.ls ?? "never"}`);
  const m = await query<any>(`SELECT COUNT(*)::text n, COUNT(DISTINCT shortcode)::text d FROM post_metrics`);
  console.log(`\nSNAPSHOTS: ${m[0].n} rows / ${m[0].d} posts  (>1 per post means velocity is now computable)`);
  const v = await query<any>(`SELECT shortcode, views, views_per_hour FROM posts WHERE views_per_hour IS NOT NULL ORDER BY views_per_hour DESC LIMIT 3`);
  console.log("VELOCITY SAMPLE:");
  if (!v.length) console.log("  (none yet - needs two snapshots per post)");
  for (const r of v) console.log(`  ${r.shortcode}  ${r.views} views  ${r.views_per_hour}/hr`);
  process.exit(0);
})();
