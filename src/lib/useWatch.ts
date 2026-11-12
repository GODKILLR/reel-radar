"use client";

import { useCallback, type Dispatch, type SetStateAction } from "react";
import type { Post } from "./types";
import { api, postJson } from "./client";

/**
 * Save/unsave a reel to the user's ideas board. Optimistic - starring should
 * feel instant while scanning a grid - and rolled back if the server refuses,
 * e.g. because the plan's saved-ideas limit has been reached.
 */
export function useWatch(
  setPosts: Dispatch<SetStateAction<Post[]>>,
  onError: (message: string) => void
) {
  return useCallback(
    async (post: Post) => {
      const nextWatched = !post.is_watchlisted;

      const apply = (watched: boolean, status: string | null) =>
        setPosts((prev) =>
          prev.map((p) =>
            p.shortcode === post.shortcode
              ? { ...p, is_watchlisted: watched, watchlist_status: status }
              : p
          )
        );

      apply(nextWatched, nextWatched ? "idea" : null);

      try {
        if (nextWatched) {
          await postJson("/api/watchlist", { shortcode: post.shortcode });
        } else {
          await api(`/api/watchlist/${post.shortcode}`, { method: "DELETE" });
        }
      } catch (err) {
        // Roll back so the star never lies about what is stored.
        apply(post.is_watchlisted, post.watchlist_status);
        onError(err instanceof Error ? err.message : "Could not save that.");
      }
    },
    [setPosts, onError]
  );
}
