import { query } from "../src/lib/db";
(async () => {
  const c = await query<any>(`
    SELECT username, display_name, median_views, post_count,
      (SELECT COUNT(*) FROM posts p WHERE p.competitor_id=c.id AND p.is_reel) reels,
      (SELECT COUNT(*) FROM posts p WHERE p.competitor_id=c.id AND p.outlier_score>=3) outliers,
      (SELECT to_char(MIN(posted_at),'YYYY-MM-DD') FROM posts p WHERE p.competitor_id=c.id) oldest,
      (SELECT to_char(MAX(posted_at),'YYYY-MM-DD') FROM posts p WHERE p.competitor_id=c.id) newest
    FROM competitors c ORDER BY username`);
  for (const r of c) {
    console.log(`@${r.username} "${r.display_name??''}"`);
    console.log(`   ${r.post_count} posts (${r.reels} reels) | ${r.oldest} -> ${r.newest}`);
    console.log(`   median views: ${Number(r.median_views||0).toLocaleString()} | outliers (3x+): ${r.outliers}`);
  }
  console.log("\nTOP OUTLIERS -- these beat their own account's baseline:");
  const o = await query<any>(`
    SELECT c.username, p.shortcode, p.views, p.likes, p.outlier_score, p.duration_sec,
           to_char(p.posted_at,'YYYY-MM-DD') d, left(replace(coalesce(p.caption,''),E'\n',' '),52) cap
    FROM posts p JOIN competitors c ON c.id=p.competitor_id
    WHERE p.outlier_score IS NOT NULL ORDER BY p.outlier_score DESC LIMIT 8`);
  for (const r of o)
    console.log(`  ${String(r.outlier_score).padStart(6)}x  @${r.username.padEnd(15)} ${String(Number(r.views).toLocaleString()).padStart(11)} views  ${r.d}  ${Number(r.duration_sec||0).toFixed(0)}s  "${r.cap}"`);
  console.log("\nMOST RECENT:");
  const n = await query<any>(`
    SELECT c.username, p.views, p.outlier_score, to_char(p.posted_at,'MM-DD HH24:MI') d,
           left(replace(coalesce(p.caption,''),E'\n',' '),46) cap
    FROM posts p JOIN competitors c ON c.id=p.competitor_id
    ORDER BY p.posted_at DESC LIMIT 6`);
  for (const r of n)
    console.log(`  ${r.d}  @${r.username.padEnd(15)} ${String(Number(r.views).toLocaleString()).padStart(10)} views  ${r.outlier_score?r.outlier_score+'x':'(too new to score)'}  "${r.cap}"`);
  process.exit(0);
})();
