/** One normalized Instagram post, shaped to our `posts` table. */
export interface NormalizedPost {
  shortcode: string;
  username: string;
  postType: string | null;
  productType: string | null;
  isReel: boolean;
  url: string | null;
  caption: string | null;
  hashtags: string[];
  mentions: string[];
  thumbnailUrl: string | null;
  videoUrl: string | null;
  durationSec: number | null;
  postedAt: Date;
  /** Plays -- the number Instagram's UI shows as "views". */
  views: number;
  /** Accounts reached. 0 when the actor does not report it. */
  reach: number;
  likes: number;
  comments: number;
  isPaidPartnership: boolean;
  audioId: string | null;
  audioSong: string | null;
  audioArtist: string | null;
  audioIsOriginal: boolean | null;
  ownerFullName: string | null;
  ownerProfilePic: string | null;
}

export interface BuildInputOptions {
  usernames: string[];
  windowDays: number;
  limitPerProfile: number;
}

/** Which optional signals an actor can actually provide. */
export interface ActorCapabilities {
  /** videoViewCount, needed for the replay-ratio metric. */
  reach: boolean;
  /** musicInfo, needed for trending-audio grouping. */
  audio: boolean;
  /** Structured hashtag/mention arrays rather than caption parsing. */
  structuredTags: boolean;
  /** Paid-partnership flag. */
  paidPartnership: boolean;
  /** Profile picture URL. */
  profilePic: boolean;
}

/**
 * Adapts one Apify actor to our schema. Actors differ wildly in field naming,
 * input shape, pricing and which signals they expose, so each one gets an
 * adapter and the rest of the app stays actor-agnostic.
 */
export interface ActorAdapter {
  /** Short key used by the APIFY_ACTOR env var. */
  key: string;
  /** Apify actor id, tilde-separated for the REST API. */
  actorId: string;
  label: string;
  /** Charged per post written to the dataset. */
  costPerPostUsd: number;
  /** Charged per run start (0 if the actor has no start fee). */
  startCostUsd: number;
  /** Run memory. Some actors bill the start fee per GB, so keep this low. */
  memoryMbytes: number;
  capabilities: ActorCapabilities;
  buildInput(opts: BuildInputOptions): Record<string, unknown>;
  normalize(raw: Record<string, unknown>): NormalizedPost | null;
}

// ---- shared parsing helpers ----

export function str(v: unknown): string | null {
  return typeof v === "string" && v.length > 0 ? v : null;
}

export function int(v: unknown): number {
  const n = typeof v === "string" ? Number(v) : v;
  return typeof n === "number" && Number.isFinite(n) ? Math.round(n) : 0;
}

export function strArray(v: unknown): string[] {
  return Array.isArray(v)
    ? (v as unknown[]).filter((x): x is string => typeof x === "string")
    : [];
}

/**
 * Pulls #hashtags and @mentions out of a caption. Used for actors that return
 * only raw caption text. Instagram allows letters, digits, underscores and
 * (for handles) periods.
 */
export function tagsFromCaption(caption: string | null): {
  hashtags: string[];
  mentions: string[];
} {
  if (!caption) return { hashtags: [], mentions: [] };
  const hashtags = [
    ...new Set(
      [...caption.matchAll(/#([\p{L}\p{N}_]+)/gu)].map((m) => m[1])
    ),
  ];
  const mentions = [
    ...new Set(
      [...caption.matchAll(/@([A-Za-z0-9._]+)/g)].map((m) =>
        m[1].replace(/\.+$/, "")
      )
    ),
  ];
  return { hashtags, mentions };
}
