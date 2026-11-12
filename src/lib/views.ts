import type { NormalizedPost } from "./actors";

/** Fewer reels than this and "none of them have views" proves nothing. */
export const MIN_REELS_TO_JUDGE = 3;

/**
 * Accounts whose reels all came back with no view counts at all.
 *
 * Some accounts' reels are served by the cheap collector without any view
 * figure, so every reel shows 0 views and no outlier can ever be scored. That
 * is the signal to move the account to the fuller collector. Needs at least
 * MIN_REELS_TO_JUDGE reels so a handful of brand-new reels (which legitimately
 * have almost no views yet) is never mistaken for it.
 */
export function accountsWithoutViews(posts: NormalizedPost[]): string[] {
  const byUser = new Map<string, { reels: number; withViews: number }>();
  for (const p of posts) {
    if (!p.isReel) continue;
    const s = byUser.get(p.username) ?? { reels: 0, withViews: 0 };
    s.reels += 1;
    if (p.views > 0) s.withViews += 1;
    byUser.set(p.username, s);
  }
  return [...byUser.entries()]
    .filter(([, s]) => s.reels >= MIN_REELS_TO_JUDGE && s.withViews === 0)
    .map(([username]) => username);
}
