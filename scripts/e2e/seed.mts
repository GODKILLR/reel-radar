// Seeds the throwaway local DB: schema + fake shared posts. Local only.
import { migrate, query } from "../../src/lib/db";

if (!process.env.DATABASE_URL?.includes("localhost:5433")) {
  throw new Error("Refusing to seed: DATABASE_URL is not the local scratch DB");
}

await migrate();
await migrate(); // idempotent: second run must not fail

// alpha: 250 reels (tests the 200-reel window) + 5 photos, FEATURED.
// beta/gamma/delta: small accounts.
for (const [u, curated, scraped] of [
  ["alpha", true, 1],
  ["beta", false, 1],
  ["gamma", false, 1],
  ["delta", false, 1],
] as const) {
  await query(
    `INSERT INTO competitors (username, is_curated, backfilled_at, last_scraped_at, median_views)
     VALUES ($1, $2, now(), now(), 1000) ON CONFLICT (username) DO NOTHING`,
    [u, curated]
  );
  void scraped;
}

const ids = Object.fromEntries(
  (await query<{ id: number; username: string }>(`SELECT id, username FROM competitors`)).map(
    (r) => [r.username, r.id]
  )
);

async function post(comp: string, i: number, reel: boolean, score: number | null) {
  await query(
    `INSERT INTO posts (shortcode, competitor_id, is_reel, posted_at, views, outlier_score, url)
     VALUES ($1, $2, $3, now() - ($4 || ' hours')::interval, $5, $6, $7)
     ON CONFLICT DO NOTHING`,
    [`${comp}-${reel ? "r" : "p"}${i}`, ids[comp], reel, String(i * 3), 1000 + i, score, `https://example.com/${comp}${i}`]
  );
}

// alpha: reel index 0 is newest. Mark a few as outliers, including OLD ones
// (index 230-240) that fall outside the free 200-reel window.
for (let i = 0; i < 250; i++) await post("alpha", i, true, i % 25 === 0 || (i >= 230 && i < 240) ? 6 : 1);
for (let i = 0; i < 5; i++) await post("alpha", i, false, null);
for (let i = 0; i < 12; i++) await post("beta", i, true, i < 4 ? 8 : 1);
for (let i = 0; i < 5; i++) await post("gamma", i, true, 1);
for (let i = 0; i < 5; i++) await post("delta", i, true, 4);

const [{ n }] = await query<{ n: string }>(`SELECT COUNT(*)::text n FROM posts`);
console.log("seeded", n, "posts; competitor ids", JSON.stringify(ids));
process.exit(0);
