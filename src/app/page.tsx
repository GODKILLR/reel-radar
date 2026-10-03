"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import PostCard from "@/components/PostCard";
import Toolbar, { type Filters } from "@/components/Toolbar";
import type { Competitor, Post, Stats } from "@/lib/types";
import { compactNumber, relativeTime } from "@/lib/format";

const PAGE_SIZE = 60;

const DEFAULT_FILTERS: Filters = {
  sort: "recent",
  competitorId: "all",
  days: "all",
  type: "all",
  outliersOnly: false,
  watchlistOnly: false,
  q: "",
};

export default function FeedPage() {
  const [filters, setFilters] = useState<Filters>(DEFAULT_FILTERS);
  const [debouncedQ, setDebouncedQ] = useState("");
  const [posts, setPosts] = useState<Post[]>([]);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [competitors, setCompetitors] = useState<Competitor[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [audioId, setAudioId] = useState<string | null>(null);
  const [audioLabel, setAudioLabel] = useState<string | null>(null);

  // Debounce the search box so typing does not fire a query per keystroke.
  useEffect(() => {
    const t = setTimeout(() => setDebouncedQ(filters.q), 300);
    return () => clearTimeout(t);
  }, [filters.q]);

  const queryString = useMemo(() => {
    const sp = new URLSearchParams({
      sort: filters.sort,
      competitorId: filters.competitorId,
      days: filters.days,
      type: filters.type,
      limit: String(PAGE_SIZE),
    });
    if (filters.outliersOnly) sp.set("outliersOnly", "1");
    if (filters.watchlistOnly) sp.set("watchlistOnly", "1");
    if (debouncedQ) sp.set("q", debouncedQ);
    if (audioId) sp.set("audioId", audioId);
    return sp.toString();
  }, [filters, debouncedQ, audioId]);

  // Any filter change resets pagination back to the first page.
  const prevQuery = useRef(queryString);
  useEffect(() => {
    if (prevQuery.current !== queryString) {
      prevQuery.current = queryString;
      setOffset(0);
    }
  }, [queryString]);

  const load = useCallback(
    async (append: boolean, atOffset: number) => {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch(`/api/posts?${queryString}&offset=${atOffset}`);
        if (!res.ok) throw new Error(`Request failed (${res.status})`);
        const data = (await res.json()) as { posts: Post[]; total: number };
        setPosts((prev) => (append ? [...prev, ...data.posts] : data.posts));
        setTotal(data.total);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load posts.");
      } finally {
        setLoading(false);
      }
    },
    [queryString]
  );

  useEffect(() => {
    void load(offset > 0, offset);
  }, [load, offset]);

  useEffect(() => {
    void (async () => {
      try {
        const [c, s] = await Promise.all([
          fetch("/api/competitors").then((r) => r.json()),
          fetch("/api/stats").then((r) => r.json()),
        ]);
        setCompetitors(c.competitors ?? []);
        setStats(s);
      } catch {
        // The header strip is non-essential; the feed still works without it.
      }
    })();
  }, []);

  const toggleWatch = useCallback(async (post: Post) => {
    const nextWatched = !post.is_watchlisted;

    // Optimistic: starring should feel instant while scanning a grid.
    setPosts((prev) =>
      prev.map((p) =>
        p.shortcode === post.shortcode
          ? {
              ...p,
              is_watchlisted: nextWatched,
              watchlist_status: nextWatched ? "idea" : null,
            }
          : p
      )
    );

    try {
      const res = nextWatched
        ? await fetch("/api/watchlist", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ shortcode: post.shortcode }),
          })
        : await fetch(`/api/watchlist/${post.shortcode}`, { method: "DELETE" });
      if (!res.ok) throw new Error("save failed");
    } catch {
      // Roll back so the star never lies about what is stored.
      setPosts((prev) =>
        prev.map((p) =>
          p.shortcode === post.shortcode
            ? {
                ...p,
                is_watchlisted: post.is_watchlisted,
                watchlist_status: post.watchlist_status,
              }
            : p
        )
      );
    }
  }, []);

  const pickAudio = useCallback(
    (id: string) => {
      const match = posts.find((p) => p.audio_id === id);
      setAudioLabel(
        match?.audio_is_original
          ? `original audio by @${match.username}`
          : match?.audio_song ?? "this sound"
      );
      setAudioId(id);
    },
    [posts]
  );

  const hasMore = posts.length < total;

  return (
    <>
      <StatStrip stats={stats} />

      <Toolbar
        filters={filters}
        competitors={competitors}
        total={total}
        loading={loading}
        onChange={(patch) => setFilters((f) => ({ ...f, ...patch }))}
      />

      {audioId && (
        <div className="mb-3 flex items-center justify-between gap-3 rounded-lg border bg-[var(--surface)] p-3 text-sm">
          <span>
            Showing tracked reels using{" "}
            <strong>♪ {audioLabel}</strong>
          </span>
          <button
            type="button"
            onClick={() => {
              setAudioId(null);
              setAudioLabel(null);
            }}
            className="rounded-md border px-2 py-1 text-xs transition hover:border-[var(--accent)]"
          >
            Clear
          </button>
        </div>
      )}

      {error && (
        <div className="mb-4 rounded-lg border border-[var(--hot)] bg-[var(--surface)] p-3 text-sm">
          {error}
        </div>
      )}

      {!loading && posts.length === 0 ? (
        <EmptyState hasCompetitors={competitors.length > 0} />
      ) : (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6">
          {posts.map((post) => (
            <PostCard
              key={post.shortcode}
              post={post}
              onToggleWatch={toggleWatch}
              onPickAudio={pickAudio}
            />
          ))}
        </div>
      )}

      {hasMore && (
        <div className="mt-5 flex justify-center">
          <button
            type="button"
            disabled={loading}
            onClick={() => setOffset(posts.length)}
            className="rounded-md border px-4 py-2 text-sm font-medium transition hover:border-[var(--accent)] hover:text-[var(--accent)] disabled:opacity-50"
          >
            {loading ? "Loading…" : `Load more (${total - posts.length} left)`}
          </button>
        </div>
      )}
    </>
  );
}

function StatStrip({ stats }: { stats: Stats | null }) {
  if (!stats?.summary) return null;
  const s = stats.summary;

  const items = [
    { label: "Accounts", value: s.active_competitors },
    { label: "Posts tracked", value: compactNumber(Number(s.total_posts)) },
    { label: "New in 24h", value: s.posts_last_24h },
    { label: "Outliers / 7d", value: s.outliers_last_7d, accent: true },
    { label: "Saved ideas", value: s.watchlist_count },
  ];

  return (
    <div className="mb-4 flex flex-wrap items-center gap-2">
      {items.map((item) => (
        <div
          key={item.label}
          className="flex-1 rounded-xl border bg-[var(--surface)] px-3 py-2"
        >
          <div
            className="nums text-lg font-semibold"
            style={item.accent ? { color: "var(--hot)" } : undefined}
          >
            {item.value}
          </div>
          <div className="text-[11px] uppercase tracking-wide text-[var(--muted)]">
            {item.label}
          </div>
        </div>
      ))}
      {stats.lastRun && (
        <div className="rounded-xl border bg-[var(--surface)] px-3 py-2 text-right">
          <div className="text-xs">
            {stats.lastRun.status === "failed" ? (
              <span style={{ color: "var(--hot)" }}>last check failed</span>
            ) : (
              <span style={{ color: "var(--cool)" }}>
                checked {relativeTime(stats.lastRun.started_at)}
              </span>
            )}
          </div>
          <div className="nums text-[11px] text-[var(--muted)]">
            ${Number(stats.spend?.last_30d ?? 0).toFixed(2)} / 30d
          </div>
        </div>
      )}
    </div>
  );
}

function EmptyState({ hasCompetitors }: { hasCompetitors: boolean }) {
  return (
    <div className="rounded-xl border bg-[var(--surface)] p-10 text-center">
      <p className="text-sm font-medium">
        {hasCompetitors
          ? "No posts match these filters yet."
          : "No competitors tracked yet."}
      </p>
      <p className="mt-1 text-sm text-[var(--muted)]">
        {hasCompetitors ? (
          "If you just added an account, its backfill runs on the next poll and can take a few minutes to land."
        ) : (
          <>
            Add one on the{" "}
            <a href="/competitors" className="text-[var(--accent)] underline">
              Competitors
            </a>{" "}
            page to start collecting.
          </>
        )}
      </p>
    </div>
  );
}
