"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import PostCard from "@/components/PostCard";
import Toolbar, { type Filters } from "@/components/Toolbar";
import type { Competitor, Post, Stats } from "@/lib/types";
import { compactNumber, relativeTime } from "@/lib/format";
import { api, autoCollect } from "@/lib/client";
import { useWatch } from "@/lib/useWatch";

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
  const [competitorsLoaded, setCompetitorsLoaded] = useState(false);
  const [stats, setStats] = useState<Stats | null>(null);
  const [audioId, setAudioId] = useState<string | null>(null);
  const [audioLabel, setAudioLabel] = useState<string | null>(null);
  const [collectNote, setCollectNote] = useState<string | null>(null);

  // Opening the feed checks whether any account is due and collects it on the
  // user's own key, so data stays fresh without relying on a timer.
  useEffect(() => {
    void (async () => {
      const c = await autoCollect();
      if (c?.outcome === "started") setCollectNote(c.message);
      else if (c?.outcome === "out_of_credit" || c?.outcome === "invalid") {
        setCollectNote(c.message);
      }
    })();
  }, []);

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
        const data = await api<{ posts: Post[]; total: number }>(
          `/api/posts?${queryString}&offset=${atOffset}`
        );
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
          api<{ competitors: Competitor[] }>("/api/competitors"),
          api<Stats>("/api/stats"),
        ]);
        setCompetitors(c.competitors ?? []);
        setStats(s);
      } catch {
        // The header strip is non-essential; the feed still works without it.
      } finally {
        setCompetitorsLoaded(true);
      }
    })();
  }, []);

  const toggleWatch = useWatch(setPosts, setError);

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
  const hasNoAccounts = competitorsLoaded && competitors.length === 0;

  return (
    <>
      <section className="mb-6">
        <p className="sl-label text-[var(--muted)]">
          <span style={{ color: "var(--hot)" }}>●</span> 01 · My feed
        </p>
        <h1 className="mt-2 max-w-3xl text-4xl font-extrabold leading-[1.02] tracking-tight sm:text-5xl">
          Spot the reels that <span className="sl-kw">break</span> the pattern.
        </h1>
        <p className="mt-3 max-w-xl text-base text-[var(--muted)]">
          Every reel flagged here beat its own account&apos;s average. Copy the
          idea while it&apos;s still working.
        </p>
      </section>

      {collectNote && (
        <div role="status" className="sl-card mb-4 p-3 text-sm font-semibold" style={{ background: "var(--cool)" }}>
          {collectNote}
        </div>
      )}

      <StatStrip stats={stats} />

      {!hasNoAccounts && (
        <Toolbar
          filters={filters}
          competitors={competitors}
          total={total}
          loading={loading}
          onChange={(patch) => setFilters((f) => ({ ...f, ...patch }))}
        />
      )}

      {audioId && (
        <div className="sl-card mb-4 flex items-center justify-between gap-3 p-3 text-sm">
          <span>
            Showing tracked reels using <strong>♪ {audioLabel}</strong>
          </span>
          <button
            type="button"
            onClick={() => {
              setAudioId(null);
              setAudioLabel(null);
            }}
            className="sl-btn sl-btn-sm"
          >
            Clear
          </button>
        </div>
      )}

      {error && (
        <div
          role="alert"
          className="sl-card mb-4 p-3 text-sm font-semibold"
          style={{ background: "var(--hot)", color: "#fff" }}
        >
          {error}
        </div>
      )}

      {hasNoAccounts ? (
        <Onboarding />
      ) : !loading && posts.length === 0 ? (
        <EmptyState />
      ) : (
        <div className="grid grid-cols-1 gap-4 min-[480px]:grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6">
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
            className="sl-btn"
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
    { label: "Accounts", value: s.accounts },
    { label: "Reels in view", value: compactNumber(Number(s.total_posts)) },
    { label: "New in 24h", value: s.posts_last_24h },
    { label: "Outliers / 7d", value: s.outliers_last_7d, accent: true },
    { label: "Saved ideas", value: s.saved },
  ];

  const { updatedAt, delayed } = stats.freshness;

  return (
    <div className="mb-6 grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">
      {items.map((item) => (
        <div
          key={item.label}
          className="sl-card sl-halftone px-4 py-3"
          style={
            item.accent
              ? { background: "var(--hot)", color: "#fff" }
              : undefined
          }
        >
          <div className="nums text-3xl font-extrabold leading-none tracking-tight">
            {item.value}
          </div>
          <div
            className="sl-label mt-1.5 text-[10px]"
            style={{ opacity: item.accent ? 0.95 : 0.65 }}
          >
            {item.label}
          </div>
        </div>
      ))}
      {updatedAt && (
        <div
          className="sl-card px-4 py-3"
          style={{ background: delayed ? "var(--warm)" : "var(--surface)" }}
        >
          <div className="flex items-center gap-2 text-sm font-bold">
            <span
              aria-hidden
              className="inline-block h-2.5 w-2.5 rounded-full border-2"
              style={{ background: delayed ? "var(--hot)" : "var(--cool)" }}
            />
            {delayed ? "Refresh delayed" : "Up to date"}
          </div>
          <div className="sl-label mt-1.5 text-[10px] opacity-65">
            updated {relativeTime(updatedAt)}
          </div>
        </div>
      )}
    </div>
  );
}

/** First-run state: nothing tracked yet, so point at the two ways forward. */
function Onboarding() {
  return (
    <div className="sl-card p-10 text-center">
      <p className="text-2xl font-extrabold">
        Your feed is <span className="sl-kw">empty</span> - for now.
      </p>
      <p className="mx-auto mt-2 max-w-md text-sm text-[var(--muted)]">
        Add up to three Instagram accounts to track, or start with this
        month&apos;s strongest outliers in Discover.
      </p>
      <div className="mt-5 flex flex-wrap justify-center gap-3">
        <Link href="/competitors" className="sl-btn sl-btn-primary">
          Track an account →
        </Link>
        <Link href="/discover" className="sl-btn">
          Browse Discover
        </Link>
      </div>
    </div>
  );
}

function EmptyState() {
  return (
    <div className="sl-card p-12 text-center">
      <p className="text-xl font-extrabold">No posts match these filters yet.</p>
      <p className="mx-auto mt-2 max-w-md text-sm text-[var(--muted)]">
        If you just added an account, its history is collected shortly and can
        take a little while to appear.
      </p>
    </div>
  );
}
