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
    <article className="sl-card sl-card-hover group flex flex-col overflow-hidden">
      <div className="relative aspect-[4/5] overflow-hidden min-[480px]:aspect-[9/13] border-b-[2.5px] bg-[var(--surface-2)]">
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
          <div className="sl-label flex h-full w-full items-center justify-center text-[var(--muted)]">
            thumbnail expired
          </div>
        )}

        <div className="pointer-events-none absolute inset-x-0 top-0 flex items-start justify-between gap-2 p-2.5">
          <div className="flex flex-wrap items-center gap-1.5">
            {heat !== "none" && score !== null && (
              <span
                className="sl-sticker nums"
                style={
                  heat === "hot"
                    ? { background: "var(--hot)", color: "#fff" }
                    : { background: "var(--warm)", color: "var(--ink)" }
                }
                title={`${score.toFixed(1)}x this account's median views`}
              >
                {score.toFixed(1)}×
              </span>
            )}
            {isFresh && (
              <span className="sl-tag" style={{ background: "var(--cool)" }}>
                New
              </span>
            )}
            {post.is_paid_partnership && (
              <span
                className="sl-tag"
                title="Paid partnership - this reach was partly bought"
              >
                Ad
              </span>
            )}
          </div>
          {len && (
            <span className="sl-tag nums" style={{ background: "var(--ink)", color: "#fff" }}>
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
          className="absolute bottom-2.5 right-2.5 flex h-9 w-9 items-center justify-center rounded-full border-[2.5px] bg-white text-lg leading-none opacity-0 shadow-[2px_2px_0_var(--ink)] transition focus:opacity-100 group-hover:opacity-100 aria-pressed:opacity-100 [@media(hover:none)]:opacity-100"
          style={{ color: post.is_watchlisted ? "var(--accent)" : "var(--ink)" }}
        >
          {post.is_watchlisted ? "★" : "☆"}
        </button>

        {post.watchlist_status && (
          <span
            className="sl-tag absolute bottom-2.5 left-2.5"
            style={{ background: "var(--cool)" }}
          >
            {STATUS_LABEL[post.watchlist_status] ?? post.watchlist_status}
          </span>
        )}
      </div>

      <div className="flex flex-1 flex-col gap-3 p-3.5">
        <div className="flex items-center justify-between gap-2 text-xs">
          <a
            href={`https://www.instagram.com/${post.username}/`}
            target="_blank"
            rel="noopener noreferrer"
            className="truncate text-[13px] font-bold underline-offset-2 hover:underline"
          >
            @{post.username}
          </a>
          <time
            dateTime={post.posted_at}
            title={new Date(post.posted_at).toLocaleString()}
            className="sl-label shrink-0 text-[10px] text-[var(--muted)]"
          >
            {relativeTime(post.posted_at)}
          </time>
        </div>

        {/* Views are the headline number; velocity rides next to it. */}
        <div className="flex items-end justify-between gap-2">
          <div>
            <div className="nums text-[28px] font-extrabold leading-none tracking-tight">
              {compactNumber(views)}
            </div>
            <div className="sl-label mt-1 text-[10px] text-[var(--muted)]">
              views
            </div>
          </div>
          {velocity !== null && velocity > 0 && (
            <span
              className="sl-tag nums"
              style={{ background: "var(--cool)" }}
              title="Views gained per hour since the last check"
            >
              ↑ {compactNumber(velocity)}/hr
            </span>
          )}
        </div>

        <div className="nums grid grid-cols-3 divide-x-2 rounded-xl border-2 text-center">
          <Metric
            label="likes"
            value={likes > 0 ? compactNumber(likes) : "—"}
            title={likes > 0 ? undefined : "This account hides its like counts"}
          />
          <Metric label="comments" value={compactNumber(comments)} />
          <Metric
            label="engage"
            value={engagementRate(likes, comments, views)}
            title="(likes + comments) / views"
          />
        </div>

        {replays !== null && (
          <p
            className="sl-label text-[10px] text-[var(--muted)]"
            title="Plays divided by accounts reached - above 1.5x means people re-watched it"
          >
            {replays.toFixed(1)}× replay ratio
          </p>
        )}

        {post.audio_song && (
          <button
            type="button"
            disabled={!post.audio_id || !onPickAudio}
            onClick={() => post.audio_id && onPickAudio?.(post.audio_id)}
            title={
              post.audio_id
                ? "Show every tracked reel using this sound"
                : undefined
            }
            className="truncate rounded-lg bg-[var(--surface-2)] px-2 py-1.5 text-left text-[11px] font-semibold text-[var(--muted)] transition enabled:hover:text-[var(--ink)]"
          >
            ♪ {post.audio_is_original ? "Original audio" : post.audio_song}
            {post.audio_artist && !post.audio_is_original
              ? ` · ${post.audio_artist}`
              : ""}
          </button>
        )}

        {post.caption && (
          <p className="line-clamp-2 text-xs leading-snug text-[var(--muted)]">
            {post.caption}
          </p>
        )}

        <a
          href={post.url ?? `https://www.instagram.com/p/${post.shortcode}/`}
          target="_blank"
          rel="noopener noreferrer"
          className="sl-btn sl-btn-primary sl-btn-sm mt-auto"
        >
          Open reel ↗
        </a>
      </div>
    </article>
  );
}

function Metric({
  label,
  value,
  title,
}: {
  label: string;
  value: string;
  title?: string;
}) {
  return (
    <div className="px-1 py-1.5" title={title}>
      <div className="text-sm font-bold">{value}</div>
      <div className="sl-label text-[9px] text-[var(--muted)]">{label}</div>
    </div>
  );
}
