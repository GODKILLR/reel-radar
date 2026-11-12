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
  backfilled_at: string | null;
  last_scraped_at: string | null;
  median_views: string | null;
  post_count: number;
  posts_last_7d: string;
  outliers_last_30d: string;
}

/** What a signed-in user is told about freshness and their own counts. */
export interface Stats {
  summary: {
    accounts: string;
    total_posts: string;
    posts_last_24h: string;
    outliers_last_7d: string;
    saved: string;
  };
  freshness: { updatedAt: string | null; delayed: boolean };
  settings: { outlierThreshold: number };
}

export interface PlanLimits {
  maxAccounts: number;
  reelsPerAccount: number;
  refreshHours: number;
  savedLimit: number;
  discoverLimit: number;
  monthlyPoints: number;
}

export interface Me {
  user: {
    id: number;
    email: string;
    name: string | null;
    plan: string;
    planName: string;
    /** Collecting on their own key (unlocks higher limits). */
    ownKey: boolean;
    points: number;
    pointsResetAt: string;
    isAdmin: boolean;
    limits: PlanLimits;
  };
  usage: { accounts: number; saved: number };
  ledger: {
    delta: number;
    balance_after: number;
    reason: string;
    created_at: string;
  }[];
  addAccountCost: number;
  plans: {
    id: string;
    name: string;
    blurb: string;
    maxAccounts: number;
    reelsPerAccount: number;
    refreshHours: number;
    savedLimit: number;
    discoverLimit: number;
    monthlyPoints: number;
  }[];
}

export type SortKey =
  | "recent"
  | "oldest"
  | "views"
  | "velocity"
  | "outlier"
  | "likes"
  | "engagement";
