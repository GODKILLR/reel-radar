export interface Post {
  shortcode: string;
  url: string | null;
  caption: string | null;
  hashtags: string[] | null;
  mentions: string[] | null;
  thumbnail_url: string | null;
  video_url: string | null;
  post_type: string | null;
  product_type: string | null;
  is_reel: boolean;
  duration_sec: string | null;
  posted_at: string;
  /** videoPlayCount: the number Instagram surfaces as "views". */
  views: string;
  /** videoViewCount: the older, smaller reach-style count. */
  reach: string;
  likes: string;
  comments: string;
  is_paid_partnership: boolean;
  audio_id: string | null;
  audio_song: string | null;
  audio_artist: string | null;
  audio_is_original: boolean | null;
  outlier_score: string | null;
  views_per_hour: string | null;
  first_seen_at: string;
  last_updated_at: string;
  competitor_id: number;
  username: string;
  display_name: string | null;
  profile_pic_url: string | null;
  median_views: string | null;
  watchlist_status: string | null;
  watchlist_note: string | null;
  is_watchlisted: boolean;
}

export interface Competitor {
  id: number;
  username: string;
  display_name: string | null;
  profile_pic_url: string | null;
  followers: string | null;
  is_active: boolean;
  backfilled_at: string | null;
  last_scraped_at: string | null;
  median_views: string | null;
  post_count: number;
  notes: string | null;
  posts_last_7d: string;
  outliers_last_30d: string;
}

export interface Stats {
  summary: {
    active_competitors: string;
    total_posts: string;
    posts_last_24h: string;
    outliers_last_7d: string;
    watchlist_count: string;
  } | null;
  lastRun: {
    tier: string;
    status: string;
    posts_seen: number;
    posts_new: number;
    cost_usd: string;
    started_at: string;
    finished_at: string | null;
    error: string | null;
  } | null;
  spend: { last_24h: string; last_30d: string } | null;
  settings: {
    outlierThreshold: number;
    hotWindowDays: number;
    warmEveryHours: number;
    actor: string;
    costPerPostUsd: number;
  };
}

export type SortKey =
  | "recent"
  | "oldest"
  | "views"
  | "velocity"
  | "outlier"
  | "likes"
  | "engagement";
