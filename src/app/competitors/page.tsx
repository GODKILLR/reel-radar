"use client";

import { useCallback, useEffect, useState } from "react";
import type { Competitor, Stats } from "@/lib/types";
import { compactNumber, relativeTime } from "@/lib/format";

export default function CompetitorsPage() {
  const [competitors, setCompetitors] = useState<Competitor[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{
    kind: "ok" | "err";
    text: string;
  } | null>(null);

  const refresh = useCallback(async () => {
    const [c, s] = await Promise.all([
      fetch("/api/competitors").then((r) => r.json()),
      fetch("/api/stats").then((r) => r.json()),
    ]);
    setCompetitors(c.competitors ?? []);
    setStats(s);
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function addCompetitor(e: React.FormEvent) {
    e.preventDefault();
    if (!input.trim() || busy) return;

    setBusy(true);
    setMessage(null);
    try {
      const res = await fetch("/api/competitors", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: input }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Could not add that account.");

      setInput("");
      setMessage({
        kind: "ok",
        text: "Added. Its post history is fetched on the next poll cycle.",
      });
      await refresh();
    } catch (err) {
      setMessage({
        kind: "err",
        text: err instanceof Error ? err.message : "Something went wrong.",
      });
    } finally {
      setBusy(false);
    }
  }

  async function togglePaused(c: Competitor) {
    await fetch(`/api/competitors/${c.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ is_active: !c.is_active }),
    });
    await refresh();
  }

  async function remove(c: Competitor) {
    // Deleting cascades to every post, metric snapshot and saved idea.
    const ok = window.confirm(
      `Remove @${c.username}? This also deletes its ${c.post_count} stored posts and any saved ideas from it.`
    );
    if (!ok) return;
    await fetch(`/api/competitors/${c.id}`, { method: "DELETE" });
    await refresh();
  }

  return (
    <>
      <h1 className="mb-1 text-lg font-semibold">Tracked competitors</h1>
      <p className="mb-4 text-sm text-[var(--muted)]">
        Active accounts are re-checked every poll cycle. Pausing keeps the data
        you have already collected but stops spending on new scrapes.
      </p>

      <form onSubmit={addCompetitor} className="mb-3 flex flex-wrap gap-2">
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="handle, @handle, or instagram.com/handle"
          className="min-w-[260px] flex-1 rounded-md border bg-[var(--surface-2)] px-3 py-2 text-sm outline-none placeholder:text-[var(--muted)] focus:border-[var(--accent)]"
        />
        <button
          type="submit"
          disabled={busy || !input.trim()}
          className="rounded-md bg-[var(--accent)] px-4 py-2 text-sm font-medium text-white transition disabled:opacity-50"
        >
          {busy ? "Adding…" : "Track account"}
        </button>
      </form>

      {message && (
        <div
          className="mb-4 rounded-lg border bg-[var(--surface)] p-3 text-sm"
          style={{
            borderColor:
              message.kind === "err" ? "var(--hot)" : "var(--cool)",
          }}
        >
          {message.text}
        </div>
      )}

      {competitors.length === 0 ? (
        <div className="rounded-xl border bg-[var(--surface)] p-10 text-center text-sm text-[var(--muted)]">
          Nothing tracked yet. Add a handle above.
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border bg-[var(--surface)]">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left text-xs uppercase tracking-wide text-[var(--muted)]">
                <Th>Account</Th>
                <Th right>Posts</Th>
                <Th right>Last 7d</Th>
                <Th right title="Median views across recent mature reels — the baseline outliers are measured against">
                  Median views
                </Th>
                <Th right title="Posts in the last 30 days at or above the outlier threshold">
                  Outliers
                </Th>
                <Th right>Last checked</Th>
                <Th right>Actions</Th>
              </tr>
            </thead>
            <tbody>
              {competitors.map((c) => (
                <tr
                  key={c.id}
                  className="border-b last:border-0 hover:bg-[var(--surface-2)]"
                >
                  <td className="px-3 py-2.5">
                    <div className="flex items-center gap-2">
                      <a
                        href={`https://www.instagram.com/${c.username}/`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="font-medium hover:text-[var(--accent)]"
                      >
                        @{c.username}
                      </a>
                      {!c.is_active && (
                        <span className="rounded bg-[var(--surface-2)] px-1.5 py-0.5 text-[10px] uppercase text-[var(--muted)]">
                          paused
                        </span>
                      )}
                      {!c.backfilled_at && (
                        <span
                          className="rounded px-1.5 py-0.5 text-[10px] uppercase"
                          style={{
                            background: "var(--accent)",
                            color: "#fff",
                          }}
                          title="History has not been fetched yet; this happens on the next poll"
                        >
                          pending
                        </span>
                      )}
                    </div>
                    {c.followers && (
                      <div className="nums text-[11px] text-[var(--muted)]">
                        {compactNumber(Number(c.followers))} followers
                      </div>
                    )}
                  </td>
                  <Td right>{c.post_count}</Td>
                  <Td right>{c.posts_last_7d}</Td>
                  <Td right>
                    {c.median_views
                      ? compactNumber(Number(c.median_views))
                      : "—"}
                  </Td>
                  <Td right>
                    {Number(c.outliers_last_30d) > 0 ? (
                      <span style={{ color: "var(--hot)" }}>
                        {c.outliers_last_30d}
                      </span>
                    ) : (
                      "0"
                    )}
                  </Td>
                  <Td right>
                    <span className="text-[var(--muted)]">
                      {relativeTime(c.last_scraped_at)}
                    </span>
                  </Td>
                  <td className="px-3 py-2.5 text-right">
                    <div className="flex justify-end gap-1.5">
                      <button
                        type="button"
                        onClick={() => togglePaused(c)}
                        className="rounded border px-2 py-1 text-xs transition hover:border-[var(--accent)]"
                      >
                        {c.is_active ? "Pause" : "Resume"}
                      </button>
                      <button
                        type="button"
                        onClick={() => remove(c)}
                        className="rounded border px-2 py-1 text-xs transition hover:border-[var(--hot)] hover:text-[var(--hot)]"
                      >
                        Remove
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <RunHistory stats={stats} />
    </>
  );
}

function RunHistory({ stats }: { stats: Stats | null }) {
  if (!stats) return null;

  return (
    <section className="mt-6">
      <h2 className="mb-2 text-sm font-semibold">Collection status</h2>
      <div className="grid gap-2 sm:grid-cols-3">
        <Card
          label="Apify spend, last 24h"
          value={`$${Number(stats.spend?.last_24h ?? 0).toFixed(2)}`}
        />
        <Card
          label="Apify spend, last 30d"
          value={`$${Number(stats.spend?.last_30d ?? 0).toFixed(2)}`}
        />
        <Card
          label="Last check"
          value={
            stats.lastRun
              ? `${stats.lastRun.tier} · ${stats.lastRun.status}`
              : "never run"
          }
          sub={
            stats.lastRun
              ? relativeTime(stats.lastRun.started_at)
              : "trigger /api/cron to start"
          }
        />
      </div>
      {stats.lastRun?.error && (
        <p
          className="mt-2 rounded-lg border p-3 text-xs"
          style={{ borderColor: "var(--hot)" }}
        >
          Last error: {stats.lastRun.error}
        </p>
      )}
      <p className="mt-3 text-xs text-[var(--muted)]">
        Outlier threshold is {stats.settings.outlierThreshold}× the account
        median. Recent posts are re-checked every cycle; the{" "}
        {stats.settings.warmEveryHours}-hour sweep covers older ones.
      </p>
    </section>
  );
}

function Card({
  label,
  value,
  sub,
}: {
  label: string;
  value: string;
  sub?: string;
}) {
  return (
    <div className="rounded-xl border bg-[var(--surface)] px-3 py-2">
      <div className="nums text-base font-semibold">{value}</div>
      <div className="text-[11px] uppercase tracking-wide text-[var(--muted)]">
        {label}
      </div>
      {sub && <div className="text-[11px] text-[var(--muted)]">{sub}</div>}
    </div>
  );
}

function Th({
  children,
  right,
  title,
}: {
  children: React.ReactNode;
  right?: boolean;
  title?: string;
}) {
  return (
    <th
      title={title}
      className={`px-3 py-2 font-medium ${right ? "text-right" : ""}`}
    >
      {children}
    </th>
  );
}

function Td({
  children,
  right,
}: {
  children: React.ReactNode;
  right?: boolean;
}) {
  return (
    <td className={`nums px-3 py-2.5 ${right ? "text-right" : ""}`}>
      {children}
    </td>
  );
}
