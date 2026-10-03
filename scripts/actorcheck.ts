/**
 * Verifies both actor adapters against verbatim payloads captured from live
 * runs, and asserts they agree on the same reel. The whole point of the
 * adapter layer is that swapping actors must not change what lands in the
 * database, so that agreement is the thing worth testing.
 */
import { lowcostAdapter } from "../src/lib/actors/lowcost";
import { officialAdapter } from "../src/lib/actors/official";
import { tagsFromCaption } from "../src/lib/actors/types";

let failures = 0;
function check(name: string, got: unknown, want: unknown) {
  const ok = String(got) === String(want);
  if (!ok) failures++;
  console.log(
    `${ok ? "PASS" : "FAIL"}  ${name}: ${got}${ok ? "" : ` (expected ${want})`}`
  );
}

// ---------------------------------------------------------------------------
// Verbatim from sones/instagram-posts-scraper-lowcost, run 3Q4qO04J2eIsAdnpO
// ---------------------------------------------------------------------------
const lowcostReel = {
  code: "DZ-dSUgSRiy",
  taken_at: 1782319751,
  media_type: 2,
  product_type: "clips",
  play_count: 58370708,
  like_count: 7116279,
  comment_count: 66876,
  video_duration: 27.927,
  post_url: "https://www.instagram.com/p/DZ-dSUgSRiy/",
  scraped_username: "zachking",
  image_url: "https://x.cdninstagram.com/t.jpg",
  video_url: "https://x.cdninstagram.com/v.mp4",
  user: {
    pk: 14805456,
    username: "zachking",
    full_name: "Zach King",
    is_verified: true,
    profile_pic_url: "https://scontent-cdg4-1.cdninstagram.com/pp.jpg",
  },
  caption: { pk: "17915451696408195", text: "this is a message to AI" },
};

// ---------------------------------------------------------------------------
// Verbatim from apify/instagram-post-scraper detailedData
// ---------------------------------------------------------------------------
const officialReel = {
  shortCode: "DZ-dSUgSRiy",
  type: "Video",
  productType: "clips",
  timestamp: "2026-06-24T18:09:11.000Z",
  videoPlayCount: 58370605,
  videoViewCount: 24358192,
  videoDuration: 27.932154,
  likesCount: 7116272,
  commentsCount: 66876,
  paidPartnership: false,
  ownerUsername: "zachking",
  ownerFullName: "Zach King",
  url: "https://www.instagram.com/p/DZ-dSUgSRiy/",
  displayUrl: "https://x.fbcdn.net/t.jpg",
  videoUrl: "https://x.fbcdn.net/v.mp4",
  hashtags: [],
  mentions: [],
  musicInfo: {
    artist_name: "zachking",
    song_name: "Original audio",
    uses_original_audio: true,
    audio_id: "27477211758621696",
  },
};

const lo = lowcostAdapter.normalize(lowcostReel)!;
const of = officialAdapter.normalize(officialReel)!;

console.log("--- lowcost adapter ---");
check("shortcode", lo.shortcode, "DZ-dSUgSRiy");
check("username lowercased", lo.username, "zachking");
check("isReel", lo.isReel, true);
check("views (play_count)", lo.views, 58370708);
check("likes", lo.likes, 7116279);
check("comments", lo.comments, 66876);
check("duration", lo.durationSec, 27.927);
check("postType from media_type 2", lo.postType, "Video");
check("profile pic captured", lo.ownerProfilePic !== null, true);
check("reach absent -> 0", lo.reach, 0);
check("audio absent -> null", lo.audioId, null);
// Unix seconds, not milliseconds: a /1000 bug would land in 1970.
check("postedAt year", lo.postedAt.getUTCFullYear(), 2026);

console.log("\n--- official adapter ---");
check("shortcode", of.shortcode, "DZ-dSUgSRiy");
check("views (videoPlayCount)", of.views, 58370605);
check("reach (videoViewCount)", of.reach, 24358192);
check("audioId", of.audioId, "27477211758621696");
check("no profile pic", of.ownerProfilePic, null);
check("postedAt year", of.postedAt.getUTCFullYear(), 2026);

console.log("\n--- adapters must agree ---");
check("same shortcode", lo.shortcode, of.shortcode);
check("same username", lo.username, of.username);
check("same isReel", lo.isReel, of.isReel);
check("same postedAt date", lo.postedAt.toISOString().slice(0, 10), of.postedAt.toISOString().slice(0, 10));
check("same comments", lo.comments, of.comments);
// Counters drift between calls, so require agreement within 0.1% rather than
// exactly -- that is what actually matters for outlier scoring.
const drift = Math.abs(lo.views - of.views) / of.views;
check(`views agree within 0.1% (drift ${(drift * 100).toFixed(4)}%)`, drift < 0.001, true);
const likeDrift = Math.abs(lo.likes - of.likes) / of.likes;
check(`likes agree within 0.1% (drift ${(likeDrift * 100).toFixed(4)}%)`, likeDrift < 0.001, true);

console.log("\n--- caption tag parsing (lowcost has no tag arrays) ---");
const t = tagsFromCaption("Love this #ootd #summerVibes2026 shot by @zach.king_1 and @natgeo!");
check("hashtags", JSON.stringify(t.hashtags), '["ootd","summerVibes2026"]');
check("mentions", JSON.stringify(t.mentions), '["zach.king_1","natgeo"]');
const t2 = tagsFromCaption(null);
check("null caption", JSON.stringify(t2.hashtags), "[]");
const t3 = tagsFromCaption("no tags at all");
check("no tags", JSON.stringify(t3.hashtags), "[]");
// A trailing period is sentence punctuation, not part of the handle.
const t4 = tagsFromCaption("thanks @someone.");
check("trailing period stripped", JSON.stringify(t4.mentions), '["someone"]');

console.log("\n--- malformed input is rejected, not stored ---");
check("lowcost: no code", lowcostAdapter.normalize({ taken_at: 1, user: {} }), null);
check("lowcost: no taken_at", lowcostAdapter.normalize({ code: "x", scraped_username: "u" }), null);
check("official: no timestamp", officialAdapter.normalize({ shortCode: "x", ownerUsername: "u" }), null);

console.log(
  failures === 0 ? "\nAll adapter checks passed." : `\n${failures} FAILED`
);
process.exit(failures === 0 ? 0 : 1);
