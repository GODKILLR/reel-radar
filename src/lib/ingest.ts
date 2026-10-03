import { query, queryOne } from "./db";
import { config } from "./config";
import type { NormalizedPost } from "./actors";

export interface IngestResult {
  seen: number;
  inserted: number;
  updated: number;
  skippedUnknownAccount: string[];
}

/**
 * Writes a batch of normalized posts. Each post is upserted and *also* appended
 * to post_metrics, so repeated polls build the time series that velocity and
 * trend charts read from.
 */
export async function ingestPosts(
  posts: NormalizedPost[]
): Promise<IngestResult> {
  const result: IngestResult = {
    seen: posts.length,
    inserted: 0,
    updated: 0,
    skippedUnknownAccount: [],
  };
  if (posts.length === 0) return result;

  // Map usernames to competitor ids once rather than per post.
  const rows = await query<{ id: number; username: string }>(
    `SELECT id, username FROM competitors`
  );
  const idByUsername = new Map(rows.map((r) => [r.username, r.id]));

  const unknown = new Set<string>();
  const known: NormalizedPost[] = [];
  for (const post of posts) {
    if (idByUsername.has(post.username)) known.push(post);
    else unknown.add(post.username);
  }
  result.skippedUnknownAccount = [...unknown];
  if (known.length === 0) return result;

  // Last write wins within a batch, so a duplicate shortcode cannot trigger
  // "ON CONFLICT DO UPDATE command cannot affect row a second time".
  const deduped = [...new Map(known.map((p) => [p.shortcode, p])).values()];

  // Everything below is set-based: a backfill can carry a few thousand posts
  // and a per-post round trip would exceed the serverless function timeout.
  const CHUNK = 500;
  for (let i = 0; i < deduped.length; i += CHUNK) {
    const batch = deduped.slice(i, i + CHUNK);
    const cols = {
      shortcode: batch.map((p) => p.shortcode),
      competitorId: batch.map((p) => idByUsername.get(p.username)!),
      postType: batch.map((p) => p.postType),
      productType: batch.map((p) => p.productType),
      isReel: batch.map((p) => p.isReel),
      url: batch.map((p) => p.url),
      caption: batch.map((p) => p.caption),
      // UNNEST cannot carry a nested array, so tag and mention lists travel as
      // joined strings and are split back out in SQL. Neither can contain a
      // comma, so the round trip is lossless.
      hashtags: batch.map((p) => p.hashtags.join(",")),
      mentions: batch.map((p) => p.mentions.join(",")),
      thumbnailUrl: batch.map((p) => p.thumbnailUrl),
      videoUrl: batch.map((p) => p.videoUrl),
      durationSec: batch.map((p) => p.durationSec),
      postedAt: batch.map((p) => p.postedAt.toISOString()),
      views: batch.map((p) => p.views),
      reach: batch.map((p) => p.reach),
      likes: batch.map((p) => p.likes),
      comments: batch.map((p) => p.comments),
      isPaidPartnership: batch.map((p) => p.isPaidPartnership),
      audioId: batch.map((p) => p.audioId),
      audioSong: batch.map((p) => p.audioSong),
      audioArtist: batch.map((p) => p.audioArtist),
      audioIsOriginal: batch.map((p) => p.audioIsOriginal),
    };

    // `xmax = 0` is true only for rows this statement actually inserted, which
    // is how we tell brand-new posts from refreshed ones.
    const upserted = await query<{ inserted: boolean }>(
      `
      INSERT INTO posts (
        shortcode, competitor_id, post_type, product_type, is_reel, url,
        caption, hashtags, mentions, thumbnail_url, video_url, duration_sec,
        posted_at, views, reach, likes, comments, is_paid_partnership,
        audio_id, audio_song, audio_artist, audio_is_original
      )
      SELECT
        t.shortcode, t.competitor_id, t.post_type, t.product_type, t.is_reel,
        t.url, t.caption,
        CASE WHEN COALESCE(t.hashtags, '') = '' THEN '{}'::text[]
             ELSE string_to_array(t.hashtags, ',') END,
        CASE WHEN COALESCE(t.mentions, '') = '' THEN '{}'::text[]
             ELSE string_to_array(t.mentions, ',') END,
        t.thumbnail_url, t.video_url, t.duration_sec, t.posted_at,
        t.views, t.reach, t.likes, t.comments, t.is_paid_partnership,
        t.audio_id, t.audio_song, t.audio_artist, t.audio_is_original
      FROM UNNEST(
        $1::text[], $2::int[], $3::text[], $4::text[], $5::boolean[],
        $6::text[], $7::text[], $8::text[], $9::text[], $10::text[],
        $11::text[], $12::numeric[], $13::timestamptz[], $14::bigint[],
        $15::bigint[], $16::bigint[], $17::bigint[], $18::boolean[],
        $19::text[], $20::text[], $21::text[], $22::boolean[]
      ) AS t(
        shortcode, competitor_id, post_type, product_type, is_reel, url,
        caption, hashtags, mentions, thumbnail_url, video_url, duration_sec,
        posted_at, views, reach, likes, comments, is_paid_partnership,
        audio_id, audio_song, audio_artist, audio_is_original
      )
      ON CONFLICT (shortcode) DO UPDATE SET
        -- Never let a flaky scrape walk a counter backwards.
        views           = GREATEST(posts.views, EXCLUDED.views),
        reach           = GREATEST(posts.reach, EXCLUDED.reach),
        likes           = GREATEST(posts.likes, EXCLUDED.likes),
        comments        = GREATEST(posts.comments, EXCLUDED.comments),
        caption         = COALESCE(EXCLUDED.caption, posts.caption),
        thumbnail_url   = COALESCE(EXCLUDED.thumbnail_url, posts.thumbnail_url),
        video_url       = COALESCE(EXCLUDED.video_url, posts.video_url),
        hashtags        = EXCLUDED.hashtags,
        mentions        = EXCLUDED.mentions,
        is_paid_partnership = EXCLUDED.is_paid_partnership,
        audio_id        = COALESCE(EXCLUDED.audio_id, posts.audio_id),
        audio_song      = COALESCE(EXCLUDED.audio_song, posts.audio_song),
        audio_artist    = COALESCE(EXCLUDED.audio_artist, posts.audio_artist),
        last_updated_at = now()
      RETURNING (xmax = 0) AS inserted
      `,
      [
        cols.shortcode, cols.competitorId, cols.postType, cols.productType,
        cols.isReel, cols.url, cols.caption, cols.hashtags, cols.mentions,
        cols.thumbnailUrl, cols.videoUrl, cols.durationSec, cols.postedAt,
        cols.views, cols.reach, cols.likes, cols.comments,
        cols.isPaidPartnership, cols.audioId, cols.audioSong,
        cols.audioArtist, cols.audioIsOriginal,
      ]
    );

    for (const row of upserted) {
      if (row.inserted) result.inserted += 1;
      else result.updated += 1;
    }

    // Always append a snapshot, even when counters are unchanged: a flat
    // reading is what tells us a reel stopped growing. Skipping it would pin
    // views_per_hour to a stale rate forever.
    //
    // Read the values back out of `posts` rather than reusing the scraped
    // ones, so the series inherits the GREATEST() monotonicity above. A single
    // spurious low reading would otherwise show up as a dip followed by a
    // fake velocity spike on the next poll.
    await query(
      `
      INSERT INTO post_metrics (shortcode, views, likes, comments)
      SELECT p.shortcode, p.views, p.likes, p.comments
      FROM posts p
      WHERE p.shortcode = ANY($1::text[])
        -- Drop snapshots that land too soon after the previous one. These come
        -- from Apify retrying a webhook that already ingested, and they would
        -- corrupt views_per_hour, which divides by the gap between the two
        -- most recent readings.
        AND NOT EXISTS (
          SELECT 1 FROM post_metrics m
          WHERE m.shortcode = p.shortcode
            AND m.captured_at > now() - ($2::int * interval '1 minute')
        )
      `,
      [cols.shortcode, config.metrics.minGapMinutes]
    );
  }

  // Refresh profile metadata from whatever the posts carried. The lowcost
  // actor supplies the profile picture; the official one does not, so this is
  // COALESCE-shaped and never overwrites a good value with a null.
  const profiles = new Map<string, NormalizedPost>();
  for (const post of deduped) {
    if (post.ownerFullName || post.ownerProfilePic) {
      profiles.set(post.username, post);
    }
  }
  for (const [username, post] of profiles) {
    await query(
      `
      UPDATE competitors SET
        display_name    = COALESCE($2, display_name),
        profile_pic_url = COALESCE($3, profile_pic_url)
      WHERE username = $1
      `,
      [username, post.ownerFullName, post.ownerProfilePic]
    );
  }

  const touched = [...new Set(deduped.map((p) => p.username))]
    .map((u) => idByUsername.get(u))
    .filter((id): id is number => typeof id === "number");

  await recomputeDerived(touched);
  await query(
    `UPDATE competitors SET last_scraped_at = now() WHERE id = ANY($1::int[])`,
    [touched]
  );

  return result;
}

/**
 * Recomputes each account's median views, then every post's outlier score and
 * views/hour. Runs after ingest so the dashboard can sort on plain columns.
 */
export async function recomputeDerived(
  competitorIds: number[]
): Promise<void> {
  if (competitorIds.length === 0) return;

  // Baseline = median views of this account's most recent N *mature* reels.
  // Immature posts would drag the median down and manufacture fake outliers.
  await query(
    `
    WITH baseline AS (
      SELECT competitor_id, views
      FROM (
        SELECT
          competitor_id,
          views,
          ROW_NUMBER() OVER (
            PARTITION BY competitor_id ORDER BY posted_at DESC
          ) AS rn
        FROM posts
        WHERE competitor_id = ANY($1::int[])
          AND is_reel
          AND views > 0
          AND posted_at < now() - ($2::int * interval '1 hour')
      ) ranked
      WHERE rn <= $3
    ),
    medians AS (
      SELECT
        competitor_id,
        PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY views) AS median_views
      FROM baseline
      GROUP BY competitor_id
    )
    UPDATE competitors c SET
      median_views = m.median_views,
      post_count = (SELECT COUNT(*) FROM posts p WHERE p.competitor_id = c.id)
    FROM medians m
    WHERE c.id = m.competitor_id
    `,
    [
      competitorIds,
      config.outlier.minAgeHours,
      config.outlier.baselineSize,
    ]
  );

  // Accounts with no mature reels yet still need an accurate post_count.
  await query(
    `
    UPDATE competitors c
    SET post_count = (SELECT COUNT(*) FROM posts p WHERE p.competitor_id = c.id)
    WHERE c.id = ANY($1::int[]) AND c.median_views IS NULL
    `,
    [competitorIds]
  );

  // Outlier score, scoped to mature posts only.
  await query(
    `
    UPDATE posts p SET outlier_score = CASE
      WHEN c.median_views IS NULL OR c.median_views = 0 THEN NULL
      WHEN p.posted_at >= now() - ($2::int * interval '1 hour') THEN NULL
      ELSE ROUND(p.views::numeric / c.median_views, 2)
    END
    FROM competitors c
    WHERE p.competitor_id = c.id AND c.id = ANY($1::int[])
    `,
    [competitorIds, config.outlier.minAgeHours]
  );

  // Velocity from the two most recent distinct snapshots.
  await query(
    `
    WITH recent AS (
      SELECT
        m.shortcode,
        m.views,
        m.captured_at,
        ROW_NUMBER() OVER (
          PARTITION BY m.shortcode ORDER BY m.captured_at DESC
        ) AS rn
      FROM post_metrics m
      JOIN posts p ON p.shortcode = m.shortcode
      WHERE p.competitor_id = ANY($1::int[])
    ),
    pairs AS (
      SELECT
        a.shortcode,
        a.views - b.views AS view_delta,
        EXTRACT(EPOCH FROM (a.captured_at - b.captured_at)) / 3600 AS hours
      FROM recent a
      JOIN recent b ON a.shortcode = b.shortcode AND b.rn = 2
      WHERE a.rn = 1
    )
    UPDATE posts p
    SET views_per_hour = CASE
      WHEN pairs.hours > 0
        THEN ROUND(GREATEST(pairs.view_delta, 0)::numeric / pairs.hours, 1)
      ELSE NULL
    END
    FROM pairs
    WHERE p.shortcode = pairs.shortcode
    `,
    [competitorIds]
  );
}
