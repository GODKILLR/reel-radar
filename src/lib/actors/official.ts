import {
  type ActorAdapter,
  type NormalizedPost,
  int,
  str,
  strArray,
} from "./types";

/**
 * apify/instagram-post-scraper -- $0.0027/post at detailedData, no start fee.
 *
 * Field names verified against live runs:
 *   productType      "clips" for reels, "feed" for photo posts
 *   videoPlayCount   total plays -- what Instagram shows as "views"
 *   videoViewCount   the older, smaller reach-style count; null on photos
 *   paidPartnership  the sponsored flag (there is no isSponsored field)
 *   musicInfo        audio_id / song_name / artist_name / uses_original_audio
 *
 * `basicData` omits every view field, so this adapter always requests
 * detailedData. It returns no profile picture or follower count at any level.
 */
export const officialAdapter: ActorAdapter = {
  key: "official",
  actorId: "apify~instagram-post-scraper",
  label: "Instagram Post Scraper (official)",
  costPerPostUsd: 0.0027,
  startCostUsd: 0,
  memoryMbytes: 1024,
  capabilities: {
    reach: true,
    audio: true,
    structuredTags: true,
    paidPartnership: true,
    profilePic: false,
  },

  buildInput({ usernames, windowDays, limitPerProfile }) {
    return {
      username: usernames,
      resultsLimit: limitPerProfile,
      onlyPostsNewerThan: `${windowDays} days`,
      skipPinnedPosts: true, // pinned posts distort "newest" ordering
      dataDetailLevel: "detailedData",
    };
  },

  normalize(raw): NormalizedPost | null {
    const shortcode = str(raw.shortCode) ?? str(raw.shortcode) ?? str(raw.code);
    const username = str(raw.ownerUsername) ?? str(raw.username);
    const timestamp = str(raw.timestamp) ?? str(raw.takenAt);

    // Without these three we cannot key, attribute, or sort the row.
    if (!shortcode || !username || !timestamp) return null;

    const postedAt = new Date(timestamp);
    if (Number.isNaN(postedAt.getTime())) return null;

    const productType = str(raw.productType);
    const postType = str(raw.type);
    const isReel =
      productType === "clips" ||
      postType === "Video" ||
      typeof raw.videoUrl === "string";

    const music = (raw.musicInfo ?? {}) as Record<string, unknown>;

    return {
      shortcode,
      username: username.toLowerCase(),
      postType,
      productType,
      isReel,
      url: str(raw.url) ?? `https://www.instagram.com/p/${shortcode}/`,
      caption: str(raw.caption),
      hashtags: strArray(raw.hashtags),
      mentions: strArray(raw.mentions),
      thumbnailUrl: str(raw.displayUrl) ?? str(raw.thumbnailUrl),
      videoUrl: str(raw.videoUrl),
      durationSec:
        typeof raw.videoDuration === "number" ? raw.videoDuration : null,
      postedAt,
      views: Math.max(int(raw.videoPlayCount), int(raw.videoViewCount)),
      reach: int(raw.videoViewCount),
      likes: int(raw.likesCount),
      comments: int(raw.commentsCount),
      isPaidPartnership: Boolean(raw.paidPartnership),
      audioId: str(music.audio_id),
      audioSong: str(music.song_name),
      audioArtist: str(music.artist_name),
      audioIsOriginal:
        typeof music.uses_original_audio === "boolean"
          ? music.uses_original_audio
          : null,
      ownerFullName: str(raw.ownerFullName),
      ownerProfilePic: null,
    };
  },
};
