"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import PostCard from "@/components/PostCard";
import type { Post } from "@/lib/types";
import { api } from "@/lib/client";
import { useWatch } from "@/lib/useWatch";

interface DiscoverData {
  posts: Post[];
  total: number;
  shown: number;
  locked: number;
}

export default function DiscoverPage() {
  const [posts, setPosts] = useState<Post[]>([]);
  const [meta, setMeta] = useState<{ total: number; locked: number } | null>(
    null
  );
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      try {
        const data = await api<DiscoverData>("/api/discover");
        setPosts(data.posts);
        setMeta({ total: data.total, locked: data.locked });
      } catch (err) {
        setError(err instanceof Error ? err.message : "Could not load Discover.");
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const toggleWatch = useWatch(setPosts, setError);

  return (
    <>
      <section className="mb-6">
        <p className="sl-label text-[var(--muted)]">
          <span style={{ color: "var(--hot)" }}>●</span> Discover
        </p>
        <h1 className="mt-2 max-w-3xl text-4xl font-extrabold leading-[1.02] tracking-tight sm:text-5xl">
          This month&apos;s <span className="sl-kw">breakout</span> reels.
        </h1>
        <p className="mt-3 max-w-xl text-base text-[var(--muted)]">
          Hand-picked accounts, ranked by how far each reel beat its own
          account&apos;s average. No setup, no points - just ideas that are
          working right now.
        </p>
      </section>

      {error && (
        <div
          role="alert"
          className="sl-card mb-4 p-3 text-sm font-semibold"
          style={{ background: "var(--hot)", color: "#fff" }}
        >
          {error}
        </div>
      )}

      {!loading && posts.length === 0 && !error ? (
        <div className="sl-card p-12 text-center">
          <p className="text-xl font-extrabold">
            Fresh picks are <span className="sl-kw">on the way.</span>
          </p>
          <p className="mx-auto mt-2 max-w-md text-sm text-[var(--muted)]">
            Nothing is featured yet. In the meantime, track your own accounts
            and the outliers will show up in your feed.
          </p>
          <Link href="/competitors" className="sl-btn sl-btn-primary mt-5">
            Track an account →
          </Link>
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6">
          {posts.map((post) => (
            <PostCard
              key={post.shortcode}
              post={post}
              onToggleWatch={toggleWatch}
            />
          ))}
        </div>
      )}

      {meta && meta.locked > 0 && (
        <div
          className="sl-card sl-halftone mt-8 flex flex-wrap items-center justify-between gap-4 p-6"
          style={{ background: "var(--dark)", color: "#fff" }}
        >
          <div>
            <p className="text-2xl font-extrabold leading-tight">
              <span className="nums">{meta.locked}</span> more outliers are{" "}
              <span className="sl-kw">waiting.</span>
            </p>
            <p className="mt-1 text-sm text-white/75">
              Your plan shows the top {posts.length}. Higher plans open the
              rest of Discover, track more accounts and refresh faster.
            </p>
          </div>
          <Link href="/account" className="sl-btn">
            See plans →
          </Link>
        </div>
      )}
    </>
  );
}
