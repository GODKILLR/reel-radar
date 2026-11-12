"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import type { Competitor, Me } from "@/lib/types";
import { compactNumber, relativeTime } from "@/lib/format";
import { api, ApiError, autoCollect, collectNow, postJson } from "@/lib/client";
import CollectorCard from "@/components/CollectorCard";

export default function AccountsPage() {
  const [competitors, setCompetitors] = useState<Competitor[]>([]);
  const [me, setMe] = useState<Me | null>(null);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{
    kind: "ok" | "err";
    text: string;
    upgrade?: boolean;
  } | null>(null);

  const refresh = useCallback(async () => {
    const [c, m] = await Promise.all([
      api<{ competitors: Competitor[] }>("/api/competitors"),
      api<Me>("/api/me"),
    ]);
    setCompetitors(c.competitors ?? []);
    setMe(m);
  }, []);

  useEffect(() => {
    void (async () => {
      await refresh();
      // Opening the page checks whether anything is due and collects it, so
      // data stays fresh without relying on any timer.
      const c = await autoCollect();
      if (c?.outcome === "started") {
        setMessage({ kind: "ok", text: c.message });
        await refresh();
      }
    })();
  }, [refresh]);

  // While reels are still being collected, check back every 15 seconds (for up
  // to ten minutes) so they appear without the user reloading.
  const waiting = competitors.some((c) => !c.last_scraped_at);
  useEffect(() => {
    if (!waiting) return;
    let ticks = 0;
    const t = setInterval(() => {
      ticks += 1;
      if (ticks > 40) clearInterval(t);
      else void refresh();
    }, 15_000);
    return () => clearInterval(t);
  }, [waiting, refresh]);

  /** "Refresh now": collect everything, ignoring how fresh it already is. */
  async function refreshNow() {
    if (busy) return;
    setBusy(true);
    setMessage(null);
    try {
      const c = await collectNow(true);
      setMessage({
        kind: c.outcome === "started" || c.outcome === "nothing_due" ? "ok" : "err",
        text: c.message,
      });
      await refresh();
    } catch (err) {
      setMessage({
        kind: "err",
        text: err instanceof Error ? err.message : "Could not refresh.",
      });
    } finally {
      setBusy(false);
    }
  }

  async function addCompetitor(e: React.FormEvent) {
    e.preventDefault();
    if (!input.trim() || busy) return;

    setBusy(true);
    setMessage(null);
    try {
      await postJson("/api/competitors", { username: input });
      setInput("");
      // Start collecting straight away, on the user's own key.
      let text = "Added.";
      try {
        const c = await collectNow();
        text =
          c.outcome === "started"
            ? "Added. Collecting its reels now - they usually appear within a few minutes."
            : `Added. ${c.message}`;
      } catch {
        text = "Added. Collection will start shortly.";
      }
      setMessage({ kind: "ok", text });
      await refresh();
    } catch (err) {
      const apiErr = err instanceof ApiError ? err : null;
      setMessage({
        kind: "err",
        text: err instanceof Error ? err.message : "Something went wrong.",
        upgrade: apiErr?.code === "account_limit",
      });
    } finally {
      setBusy(false);
    }
  }

  async function remove(c: Competitor) {
    const ok = window.confirm(
      `Stop tracking @${c.username}? Reels you saved stay on your board.`
    );
    if (!ok) return;
    try {
      await api(`/api/competitors/${c.id}`, { method: "DELETE" });
      await refresh();
    } catch (err) {
      setMessage({
        kind: "err",
        text: err instanceof Error ? err.message : "Could not remove that.",
      });
    }
  }

  const limits = me?.user.limits;
  const atLimit = !!limits && competitors.length >= limits.maxAccounts;
  // Collection runs on the user's own key, so tracking needs one connected.
  const needsKey = !!me && !me.user.canCollect;

  return (
    <>
      <p className="sl-label text-[var(--muted)]">
        <span style={{ color: "var(--hot)" }}>●</span> 02 · Accounts
      </p>
      <h1 className="mt-2 text-4xl font-extrabold leading-[1.02] tracking-tight sm:text-5xl">
        Who you&apos;re <span className="sl-kw">watching.</span>
      </h1>
      <p className="mb-6 mt-3 max-w-xl text-base text-[var(--muted)]">
        Tracked accounts are refreshed automatically
        {limits ? ` about every ${limits.refreshHours} hours` : ""}, and you see
        up to their latest {limits?.reelsPerAccount ?? 200} reels.
      </p>

      {me && !me.user.isAdmin && (
        <CollectorCard
          onChange={async () => {
            await refresh();
            // A newly connected key starts collecting any waiting accounts.
            await collectNow().catch(() => null);
            await refresh();
          }}
        />
      )}

      {me && limits && (
        <div className="mb-4 flex flex-wrap gap-4">
          <Meter
            label={`${me.user.planName} plan`}
            value={competitors.length}
            max={limits.maxAccounts}
          />
        </div>
      )}

      <form
        onSubmit={addCompetitor}
        className="sl-card mb-4 flex flex-wrap gap-3 p-4"
      >
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="handle, @handle, or instagram.com/handle"
          aria-label="Instagram handle to track"
          disabled={atLimit || needsKey}
          className="sl-input min-w-[260px] flex-1"
        />
        <button
          type="submit"
          disabled={busy || !input.trim() || atLimit || needsKey}
          className="sl-btn sl-btn-primary"
        >
          {busy ? "Working…" : "Track account"}
        </button>
        <button
          type="button"
          onClick={refreshNow}
          disabled={busy || needsKey || competitors.length === 0}
          className="sl-btn"
          title="Fetch the latest reels for all your accounts now"
        >
          Refresh now
        </button>
        {needsKey && (
          <p className="w-full text-sm font-semibold text-[var(--muted)]">
            Connect your key above to start tracking accounts.
          </p>
        )}
        {!needsKey && atLimit && (
          <p className="w-full text-sm font-semibold text-[var(--muted)]">
            You&apos;re at your plan&apos;s limit. Remove an account to add
            another, or{" "}
            <Link href="/account" className="text-[var(--ink)] underline">
              see plans
            </Link>
            .
          </p>
        )}
      </form>

      {message && (
        <div
          role={message.kind === "err" ? "alert" : "status"}
          className="sl-card mb-4 p-3 text-sm font-semibold"
          style={{
            background: message.kind === "err" ? "var(--hot)" : "var(--cool)",
            color: message.kind === "err" ? "#fff" : "var(--ink)",
          }}
        >
          {message.text}
          {message.upgrade && (
            <>
              {" "}
              <Link href="/account" className="underline">
                See plans
              </Link>
            </>
          )}
        </div>
      )}

      {competitors.length === 0 ? (
        <div className="sl-card p-12 text-center text-sm text-[var(--muted)]">
          Nothing tracked yet. Add a handle above.
        </div>
      ) : (
        <>
        {/* Phones: one card per account instead of a wide table. */}
        <ul className="flex flex-col gap-3 md:hidden" aria-label="Tracked accounts">
          {competitors.map((c) => (
            <li key={c.id} className="sl-card p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <a
                    href={`https://www.instagram.com/${c.username}/`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="block truncate text-base font-bold underline-offset-2 hover:underline"
                  >
                    @{c.username}
                  </a>
                  {c.followers && (
                    <div className="nums text-[11px] text-[var(--muted)]">
                      {compactNumber(Number(c.followers))} followers
                    </div>
                  )}
                </div>
                {!c.last_scraped_at ? (
                  <span className="sl-tag shrink-0" style={{ background: "var(--warm)" }}>
                    collecting…
                  </span>
                ) : Number(c.outliers_last_30d) > 0 ? (
                  <span
                    className="sl-tag shrink-0"
                    style={{ background: "var(--hot)", color: "#fff" }}
                  >
                    {c.outliers_last_30d} outlier{Number(c.outliers_last_30d) === 1 ? "" : "s"}
                  </span>
                ) : null}
              </div>
              <dl className="nums mt-3 grid grid-cols-3 divide-x-2 rounded-xl border-2 text-center">
                <div className="px-1 py-1.5">
                  <dd className="text-sm font-bold">{c.post_count}</dd>
                  <dt className="sl-label text-[9px] text-[var(--muted)]">posts</dt>
                </div>
                <div className="px-1 py-1.5">
                  <dd className="text-sm font-bold">{c.posts_last_7d}</dd>
                  <dt className="sl-label text-[9px] text-[var(--muted)]">last 7d</dt>
                </div>
                <div className="px-1 py-1.5">
                  <dd className="text-sm font-bold">
                    {c.median_views ? compactNumber(Number(c.median_views)) : "—"}
                  </dd>
                  <dt className="sl-label text-[9px] text-[var(--muted)]">median</dt>
                </div>
              </dl>
              <div className="mt-3 flex items-center justify-between gap-3">
                <span className="sl-label text-[10px] text-[var(--muted)]">
                  updated {relativeTime(c.last_scraped_at)}
                </span>
                <button type="button" onClick={() => remove(c)} className="sl-btn sl-btn-sm">
                  Remove
                </button>
              </div>
            </li>
          ))}
        </ul>

        <div className="sl-card hidden overflow-x-auto md:block">
          <table className="w-full text-sm">
            <thead>
              <tr className="sl-label bg-[var(--ink)] text-left text-[10px] text-white">
                <Th>Account</Th>
                <Th right>Posts</Th>
                <Th right>Last 7d</Th>
                <Th
                  right
                  title="Median views across recent mature reels — the baseline outliers are measured against"
                >
                  Median views
                </Th>
                <Th
                  right
                  title="Posts in the last 30 days at or above the outlier threshold"
                >
                  Outliers
                </Th>
                <Th right>Updated</Th>
                <Th right>Actions</Th>
              </tr>
            </thead>
            <tbody>
              {competitors.map((c) => (
                <tr
                  key={c.id}
                  className="border-b border-[var(--line)] last:border-0 hover:bg-[var(--surface-2)]"
                >
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <a
                        href={`https://www.instagram.com/${c.username}/`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="font-bold underline-offset-2 hover:underline"
                      >
                        @{c.username}
                      </a>
                      {!c.last_scraped_at && (
                        <span
                          className="sl-tag"
                          style={{ background: "var(--warm)" }}
                          title="Collecting this account's reels now. This usually takes a few minutes."
                        >
                          collecting…
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
                      <span
                        className="sl-tag"
                        style={{ background: "var(--hot)", color: "#fff" }}
                      >
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
                  <td className="px-4 py-3 text-right">
                    <button
                      type="button"
                      onClick={() => remove(c)}
                      className="sl-btn sl-btn-sm"
                    >
                      Remove
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        </>
      )}

      <p className="mt-4 text-xs text-[var(--muted)]">
        Outliers are reels with at least {3}× their account&apos;s median views.
      </p>
    </>
  );
}

function Meter({
  label,
  value,
  max,
}: {
  label: string;
  value: number;
  max: number;
}) {
  const pct = Math.min(100, Math.round((value / max) * 100));
  return (
    <div className="sl-card min-w-[220px] px-4 py-3">
      <div className="nums text-2xl font-extrabold leading-none">
        {value}
        <span className="text-sm font-bold text-[var(--muted)]"> / {max}</span>
      </div>
      <div
        className="mt-2 h-2.5 overflow-hidden rounded-full border-2 bg-white"
        role="progressbar"
        aria-valuenow={value}
        aria-valuemin={0}
        aria-valuemax={max}
        aria-label={label}
      >
        <div
          className="h-full"
          style={{
            width: `${pct}%`,
            background: pct >= 100 ? "var(--hot)" : "var(--accent)",
          }}
        />
      </div>
      <div className="sl-label mt-1.5 text-[10px] text-[var(--muted)]">
        accounts tracked · {label}
      </div>
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
      className={`px-4 py-3 font-semibold ${right ? "text-right" : ""}`}
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
    <td className={`nums px-4 py-3 ${right ? "text-right" : ""}`}>{children}</td>
  );
}
