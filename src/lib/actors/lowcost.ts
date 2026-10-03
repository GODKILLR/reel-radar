import {
  type ActorAdapter,
  type NormalizedPost,
  int,
  str,
  tagsFromCaption,
} from "./types";

/**
 * sones/instagram-posts-scraper-lowcost -- $0.0003/post plus a $0.005 start fee.
 *
 * Roughly 9x cheaper per post than apify/instagram-post-scraper, and verified
 * to return matching play counts: the same three zachking reels came back at
 * 58,370,708 / 19,053,339 / 5,920,730 against the official actor's
 * 58,370,605 / 19,053,133 / 5,918,838 (the deltas are real growth between the
 * two calls). HTTP-only, no browser.
 *
 * Trade-offs versus the official actor: no videoViewCount (so no replay ratio),
 * no musicInfo (so no trending-audio grouping), and no hashtag/mention arrays
 * (parsed out of the caption instead). It does return the profile picture,
 * which the official actor omits.
 *
 * It is a third-party actor with a small review count, so treat it as the
 * cost-optimised default rather than the dependable one -- APIFY_ACTOR=official
 * switches back.
 */
export const lowcostAdapter: ActorAdapter = {
  key: "lowcost",
  actorId: "sones~instagram-posts-scraper-lowcost",
  label: "Instagram Posts Scraper Lowcost (sones)",
  costPerPostUsd: 0.0003,
  // Billed one event per GB of run memory, minimum one event. 512MB still
  // rounds to a single event, and the actor peaked at ~138MB in testing.
  startCostUsd: 0.005,
  memoryMbytes: 512,
  capabilities: {
    reach: false,
    audio: false,
    structuredTags: false,
    paidPartnership: false,
    profilePic: true,
  },

  buildInput({ usernames, windowDays, limitPerProfile }) {
    const cutoff = new Date(Date.now() - windowDays * 86_400_000);
    return {
      usernames,
      postsPerProfile: limitPerProfile,
      // Pagination cutoff, not a strict per-post filter: the actor stops once
      // a page holds nothing newer. Slight overshoot past the window is normal.
      newerThan: cutoff.toISOString(),
      proxy: { useApifyProxy: true },
    };
  },

  normalize(raw): NormalizedPost | null {
    const shortcode = str(raw.code) ?? str(raw.shortCode);
    const user = (raw.user ?? {}) as Record<string, unknown>;
    const username = str(raw.scraped_username) ?? str(user.username);

    // taken_at is a Unix timestamp in seconds.
    const takenAt = int(raw.taken_at);
    if (!shortcode || !username || !takenAt) return null;

    const postedAt = new Date(takenAt * 1000);
    if (Number.isNaN(postedAt.getTime())) return null;

    const captionObj = (raw.caption ?? {}) as Record<string, unknown>;
    const caption = str(captionObj.text);
    const { hashtags, mentions } = tagsFromCaption(caption);

    // media_type 2 is video, 8 is a carousel; product_type "clips" is a reel.
    const productType = str(raw.product_type);
    const mediaType = int(raw.media_type);
    const isReel =
      productType === "clips" ||
      mediaType === 2 ||
      typeof raw.video_url === "string";

    const duration = raw.video_duration;

    return {
      shortcode,
      username: username.toLowerCase(),
      postType:
        mediaType === 2 ? "Video" : mediaType === 8 ? "Sidecar" : "Image",
      productType,
      isReel,
      url: str(raw.post_url) ?? `https://www.instagram.com/p/${shortcode}/`,
      caption,
      hashtags,
      mentions,
      thumbnailUrl: str(raw.image_url),
      videoUrl: str(raw.video_url),
      durationSec: typeof duration === "number" ? duration : null,
      postedAt,
      views: int(raw.play_count),
      // Not reported by this actor; the replay ratio is simply hidden.
      reach: 0,
      likes: int(raw.like_count),
      comments: int(raw.comment_count),
      isPaidPartnership: false,
      audioId: null,
      audioSong: null,
      audioArtist: null,
      audioIsOriginal: null,
      ownerFullName: str(user.full_name),
      ownerProfilePic: str(user.profile_pic_url),
    };
  },
};
