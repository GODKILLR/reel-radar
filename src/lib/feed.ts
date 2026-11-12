/**
 * SQL fragment shared by the feed and the stats: the posts a user is allowed
 * to see. Posts are shared across all users; what differs per user is
 *   1. which accounts they track, and
 *   2. how deep into each account's history their plan reaches.
 *
 * Parameters: $1 = user id, $2 = reels-per-account limit.
 * Ranks reels and non-reels separately, so "latest 100 reels" really is 100
 * reels and a burst of photo posts cannot push reels out of the window.
 */
export const VISIBLE_POSTS_CTE = `
  visible AS (
    SELECT r.shortcode
    FROM (
      SELECT p.shortcode,
             ROW_NUMBER() OVER (
               PARTITION BY p.competitor_id, p.is_reel
               ORDER BY p.posted_at DESC
             ) AS rn
      FROM posts p
      WHERE p.competitor_id IN (
        SELECT competitor_id FROM user_competitors WHERE user_id = $1
      )
    ) r
    WHERE r.rn <= $2
  )
`;
