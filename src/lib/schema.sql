-- Reel Radar schema. Safe to re-run.

CREATE TABLE IF NOT EXISTS competitors (
  id             SERIAL PRIMARY KEY,
  username       TEXT NOT NULL UNIQUE,
  display_name   TEXT,
  profile_pic_url TEXT,
  followers      BIGINT,
  is_active      BOOLEAN NOT NULL DEFAULT TRUE,
  backfilled_at  TIMESTAMPTZ,
  last_scraped_at TIMESTAMPTZ,
  -- Rolling baseline, recomputed after each ingest.
  median_views   BIGINT,
  post_count     INTEGER NOT NULL DEFAULT 0,
  notes          TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS posts (
  -- Instagram shortcode is stable and globally unique; use it as the PK.
  shortcode      TEXT PRIMARY KEY,
  competitor_id  INTEGER NOT NULL REFERENCES competitors(id) ON DELETE CASCADE,
  post_type      TEXT,                -- Video | Image | Sidecar
  product_type   TEXT,                -- clips (reel) | feed | igtv
  is_reel        BOOLEAN NOT NULL DEFAULT FALSE,
  url            TEXT,
  caption        TEXT,
  hashtags       TEXT[],
  mentions       TEXT[],
  thumbnail_url  TEXT,
  video_url      TEXT,
  duration_sec   NUMERIC,
  posted_at      TIMESTAMPTZ NOT NULL,
  -- Instagram's UI "views" is videoPlayCount (total plays). videoViewCount is
  -- the older, smaller reach-style number. Both are kept: `views` is the
  -- headline metric because it is what you see in the app, and `reach` is
  -- useful because plays/reach says how often people re-watched.
  views          BIGINT NOT NULL DEFAULT 0,
  reach          BIGINT NOT NULL DEFAULT 0,
  likes          BIGINT NOT NULL DEFAULT 0,
  comments       BIGINT NOT NULL DEFAULT 0,
  is_paid_partnership BOOLEAN NOT NULL DEFAULT FALSE,
  -- Trending-audio tracking. Reels that share an audio_id ride the same sound.
  audio_id       TEXT,
  audio_song     TEXT,
  audio_artist   TEXT,
  audio_is_original BOOLEAN,
  -- Derived metrics, refreshed after each ingest.
  outlier_score  NUMERIC,             -- views / account median
  views_per_hour NUMERIC,             -- from the two most recent snapshots
  first_seen_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS posts_posted_at_idx      ON posts (posted_at DESC);
CREATE INDEX IF NOT EXISTS posts_views_idx          ON posts (views DESC);
CREATE INDEX IF NOT EXISTS posts_outlier_idx        ON posts (outlier_score DESC NULLS LAST);
CREATE INDEX IF NOT EXISTS posts_velocity_idx       ON posts (views_per_hour DESC NULLS LAST);
CREATE INDEX IF NOT EXISTS posts_competitor_idx     ON posts (competitor_id);
CREATE INDEX IF NOT EXISTS posts_audio_idx           ON posts (audio_id)
  WHERE audio_id IS NOT NULL;

-- Time series of engagement. This is what makes velocity possible, and it is
-- the one thing you cannot reconstruct after the fact, so we never prune it
-- aggressively.
CREATE TABLE IF NOT EXISTS post_metrics (
  id          BIGSERIAL PRIMARY KEY,
  shortcode   TEXT NOT NULL REFERENCES posts(shortcode) ON DELETE CASCADE,
  captured_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  views       BIGINT NOT NULL DEFAULT 0,
  likes       BIGINT NOT NULL DEFAULT 0,
  comments    BIGINT NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS post_metrics_lookup_idx
  ON post_metrics (shortcode, captured_at DESC);

CREATE TABLE IF NOT EXISTS watchlist (
  shortcode  TEXT PRIMARY KEY REFERENCES posts(shortcode) ON DELETE CASCADE,
  status     TEXT NOT NULL DEFAULT 'idea',  -- idea | scripted | filmed | posted
  note       TEXT,
  added_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS scrape_runs (
  id            SERIAL PRIMARY KEY,
  apify_run_id  TEXT,
  tier          TEXT NOT NULL,          -- hot | warm | backfill
  usernames     TEXT[],
  status        TEXT NOT NULL,          -- started | succeeded | failed
  posts_seen    INTEGER NOT NULL DEFAULT 0,
  posts_new     INTEGER NOT NULL DEFAULT 0,
  cost_usd      NUMERIC NOT NULL DEFAULT 0,
  error         TEXT,
  started_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at   TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS scrape_runs_apify_idx ON scrape_runs (apify_run_id);
CREATE INDEX IF NOT EXISTS scrape_runs_started_idx ON scrape_runs (started_at DESC);

-- Dedupe table so a reel that stays viral across many polls alerts only once.
CREATE TABLE IF NOT EXISTS alerts (
  id         SERIAL PRIMARY KEY,
  shortcode  TEXT NOT NULL REFERENCES posts(shortcode) ON DELETE CASCADE,
  kind       TEXT NOT NULL,          -- outlier | new_post
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (shortcode, kind)
);
