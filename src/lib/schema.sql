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

-- ---------------------------------------------------------------------------
-- Multi-user (additive). Posts, metrics and outlier scores stay SHARED: if 40
-- users track the same account it is scraped once. What is per-user is who
-- tracks what, their saved ideas, and their points.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS users (
  id              BIGSERIAL PRIMARY KEY,
  email           TEXT NOT NULL UNIQUE,          -- stored lower-case
  password_hash   TEXT NOT NULL,
  name            TEXT,
  plan            TEXT NOT NULL DEFAULT 'free',  -- free | pro | studio | admin
  points          INTEGER NOT NULL DEFAULT 0,
  points_reset_at TIMESTAMPTZ NOT NULL DEFAULT (now() + interval '1 month'),
  is_admin        BOOLEAN NOT NULL DEFAULT FALSE,
  failed_logins   INTEGER NOT NULL DEFAULT 0,
  locked_until    TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_login_at   TIMESTAMPTZ
);

-- Which accounts each user tracks.
CREATE TABLE IF NOT EXISTS user_competitors (
  user_id       BIGINT  NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  competitor_id INTEGER NOT NULL REFERENCES competitors(id) ON DELETE CASCADE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, competitor_id)
);
CREATE INDEX IF NOT EXISTS user_competitors_comp_idx
  ON user_competitors (competitor_id);

-- Per-user saved ideas. (The old global `watchlist` table is left in place.)
CREATE TABLE IF NOT EXISTS user_watchlist (
  user_id   BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  shortcode TEXT   NOT NULL REFERENCES posts(shortcode) ON DELETE CASCADE,
  status    TEXT   NOT NULL DEFAULT 'idea',
  note      TEXT,
  added_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, shortcode)
);

-- Every change to a balance, so points can always be explained and audited.
CREATE TABLE IF NOT EXISTS points_ledger (
  id            BIGSERIAL PRIMARY KEY,
  user_id       BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  delta         INTEGER NOT NULL,
  balance_after INTEGER NOT NULL,
  reason        TEXT NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS points_ledger_user_idx
  ON points_ledger (user_id, created_at DESC);

-- "Connect your own collector": a user can supply their own Apify API token so
-- their accounts are collected on their credit, not ours. The token is stored
-- ENCRYPTED (AES-256-GCM, bound to the user id) and is never sent back to the
-- browser; only the last 4 characters are kept in the clear for display.
ALTER TABLE users ADD COLUMN IF NOT EXISTS collector_key_enc    TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS collector_key_last4  TEXT;
-- ok | out_of_credit | invalid (NULL = no key connected)
ALTER TABLE users ADD COLUMN IF NOT EXISTS collector_status     TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS collector_checked_at TIMESTAMPTZ;
ALTER TABLE users ADD COLUMN IF NOT EXISTS collector_credit_left NUMERIC;
ALTER TABLE users ADD COLUMN IF NOT EXISTS collector_resets_at  TIMESTAMPTZ;

-- Who paid for a collection run (NULL = the platform), and the single-use
-- token that authorises that run's completion callback. The callback URL is
-- visible inside a user's own collector account, so it must never carry a
-- global secret.
ALTER TABLE scrape_runs
  ADD COLUMN IF NOT EXISTS owner_user_id BIGINT REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE scrape_runs ADD COLUMN IF NOT EXISTS hook_nonce TEXT;
CREATE INDEX IF NOT EXISTS scrape_runs_nonce_idx ON scrape_runs (hook_nonce)
  WHERE hook_nonce IS NOT NULL;

-- Accounts featured in the Discover tab. Off by default: nothing is shown to
-- other users until an admin turns it on.
ALTER TABLE competitors
  ADD COLUMN IF NOT EXISTS is_curated BOOLEAN NOT NULL DEFAULT FALSE;

-- Dedupe table so a reel that stays viral across many polls alerts only once.
CREATE TABLE IF NOT EXISTS alerts (
  id         SERIAL PRIMARY KEY,
  shortcode  TEXT NOT NULL REFERENCES posts(shortcode) ON DELETE CASCADE,
  kind       TEXT NOT NULL,          -- outlier | new_post
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (shortcode, kind)
);
