"use client";

import { useState } from "react";
import type { Post } from "@/lib/types";
import {
  compactNumber,
  relativeTime,
  duration,
  engagementRate,
  heatOf,
} from "@/lib/format";

interface Props {
  post: Post;
  onToggleWatch: (post: Post) => void;
  /** Narrow the feed to everyone using this same sound. */
  onPickAudio?: (audioId: string) => void;
}

const STATUS_LABEL: Record<string, string> = {
  idea: "Idea",
  scripted: "Scripted",
  filmed: "Filmed",
  posted: "Posted",
};

export default function PostCard({ post, onToggleWatch, onPickAudio }: Props) {
  const [imgFailed, setImgFailed] = useState(false);

  const views = Number(post.views);
  const likes = Number(post.likes);
  const comments = Number(post.comments);
  const score = post.outlier_score ? Number(post.outlier_score) : null;
  const velocity = post.views_per_hour ? Number(post.views_per_hour) : null;
  const heat = heatOf(score);
  const len = duration(post.duration_sec);

  // Plays per account reached. Instagram exposes both numbers, and the ratio
  // is a decent proxy for rewatchability - a strong signal for a loopable hook.
  const reach = Number(post.reach);
  const replays = reach > 0 && views > 0 ? views / reach : null;

  // "New" means we first saw it on the most recent poll or two, not that the
  // post itself is new — that is what actually matters when scanning a feed.
  const isFresh =
    Date.now() - new Date(post.first_seen_at).getTime() < 3 * 3_600_000;

  return (
    <article className="group flex flex-col overflow-hidden rounded-xl border bg-[var(--surface)] transition hover:border-[var(--accent)]">
      <div className="relative aspect-[9/13] overflow-hidden bg-[var(--surface-2)]">
        {post.thumbnail_url && !imgFailed ? (
          /* eslint-disable-next-line @next/next/no-img-element */
          <img
            src={post.thumbnail_url}
            alt={post.caption?.slice(0, 80) ?? `Post by @${post.username}`}
            loading="lazy"
            referrerPolicy="no-referrer"
            onError={() => setImgFailed(true)}
            className="h-full w-full object-cover transition duration-300 group-hover:scale-[1.03]"
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-xs text-[var(--muted)]">
            thumbnail expired
          </div>
        )}

        <div className="pointer-events-none absolute inset-x-0 top-0 flex items-start justify-between gap-2 p-2">
          <div className="flex flex-wrap gap-1.5">
            {heat !== "none" && score !== null && (
              <span
                className="nums rounded-md px-1.5 py-0.5 text-[11px] font-bold text-black shadow"
                style={{
                  background: heat === "hot" ? "var(--hot)" : "var(--warm)",
                }}
                title={`${score.toFixed(1)}x this account's median views`}
              >
                {score.toFixed(1)}×
              </span>
            )}
            {isFresh && (
              <span className="rounded-md bg-[var(--accent)] px-1.5 py-0.5 text-[11px] font-bold text-white shadow">
                NEW
              </span>
            )}
            {post.is_paid_partnership && (
              <span
                className="rounded-md bg-black/65 px-1.5 py-0.5 text-[11px] font-semibold text-white shadow"
                title="Paid partnership - this reach was partly bought"
              >
                AD
              </span>
            )}
          </div>
          {len && (
            <span className="nums rounded-md bg-black/65 px-1.5 py-0.5 text-[11px] text-white">
              {len}
            </span>
          )}
        </div>

        <button
          type="button"
          onClick={() => onToggleWatch(post)}
          aria-label={
            post.is_watchlisted ? "Remove from watchlist" : "Save to watchlist"
          }
          aria-pressed={post.is_watchlisted}
          className="absolute bottom-2 right-2 rounded-md bg-black/65 px-2 py-1 text-sm leading-none text-white opacity-0 transition hover:bg-black/85 focus:opacity-100 group-hover:opacity-100 aria-pressed:opacity-100"
        >
          {post.is_watchlisted ? "★" : "☆"}
        </button>

        {post.watchlist_status && (
          <span className="absolute bottom-2 left-2 rounded-md bg-[var(--cool)] px-1.5 py-0.5 text-[11px] font-semibold text-black">
            {STATUS_LABEL[post.watchlist_status] ?? post.watchlist_status}
          </span>
        )}
      </div>

      <div className="flex flex-1 flex-col gap-2 p-2.5">
        <div className="flex items-center justify-between gap-2 text-xs">
          <a
            href={`https://www.instagram.com/${post.username}/`}
            target="_blank"
            rel="noopener noreferrer"
            className="truncate font-medium hover:text-[var(--accent)]"
          >
            @{post.username}
          </a>
          <time
            dateTime={post.posted_at}
            title={new Date(post.posted_at).toLocaleString()}
            className="shrink-0 text-[var(--muted)]"
          >
            {relativeTime(post.posted_at)}
          </time>
        </div>

        <div className="nums grid grid-cols-3 gap-1 text-center text-[11px]">
          <Metric label="views" value={compactNumber(views)} strong />
          <Metric label="likes" value={compactNumber(likes)} />
          <Metric label="comments" value={compactNumber(comments)} />
        </div>

        <div className="nums flex items-center justify-between text-[11px] text-[var(--muted)]">
          <span title="Views gained per hour since the last check">
            {velocity !== null && velocity > 0
              ? `${compactNumber(velocity)}/hr`
              : "—"}
          </span>
          {replays !== null && (
            <span title="Plays divided by accounts reached - above 1.5x means people re-watched it">
              {replays.toFixed(1)}× replay
            </span>
          )}
          <span title="(likes + comments) / views">
            {engagementRate(likes, comments, views)}
          </span>
        </div>

        {post.audio_song && (
          <button
            type="button"
            disabled={!post.audio_id || !onPickAudio}
            onClick={() =>
              post.audio_id && onPickAudio?.(post.audio_id)
            }
            title={
              post.audio_id
                ? "Show every tracked reel using this sound"
                : undefined
            }
            className="truncate rounded-md bg-[var(--surface-2)] px-1.5 py-1 text-left text-[10px] text-[var(--muted)] transition enabled:hover:text-[var(--accent)]"
          >
            ♪ {post.audio_is_original ? "Original audio" : post.audio_song}
            {post.audio_artist && !post.audio_is_original
              ? ` · ${post.audio_artist}`
              : ""}
          </button>
        )}

        {post.caption && (
          <p className="line-clamp-2 text-[11px] leading-snug text-[var(--muted)]">
            {post.caption}
          </p>
        )}

        <a
          href={post.url ?? `https://www.instagram.com/p/${post.shortcode}/`}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-auto rounded-md border px-2 py-1.5 text-center text-[11px] font-medium transition hover:border-[var(--accent)] hover:text-[var(--accent)]"
        >
          Open on Instagram →
        </a>
      </div>
    </article>
  );
}

function Metric({
  label,
  value,
  strong,
}: {
  label: string;
  value: string;
  strong?: boolean;
}) {
  return (
    <div className="rounded-md bg-[var(--surface-2)] px-1 py-1">
      <div className={strong ? "text-sm font-semibold" : "text-sm"}>
        {value}
      </div>
      <div className="text-[10px] uppercase tracking-wide text-[var(--muted)]">
        {label}
      </div>
    </div>
  );
}
