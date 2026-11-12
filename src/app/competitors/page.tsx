"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import type { Competitor, Me } from "@/lib/types";
import { compactNumber, relativeTime } from "@/lib/format";
import { api, ApiError, postJson } from "@/lib/client";
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
    void refresh();
  }, [refresh]);

  async function addCompetitor(e: React.FormEvent) {
    e.preventDefault();
    if (!input.trim() || busy) return;

    setBusy(true);
    setMessage(null);
    try {
      const res = await postJson<{ pointsSpent: number }>("/api/competitors", {
        username: input,
      });
      setInput("");
      setMessage({
        kind: "ok",
        text:
          res.pointsSpent > 0
            ? `Added. ${res.pointsSpent} points spent. Their reels will appear shortly.`
            : "Added. Their reels will appear shortly.",
      });
      await refresh();
    } catch (err) {
      const apiErr = err instanceof ApiError ? err : null;
      setMessage({
        kind: "err",
        text: err instanceof Error ? err.message : "Something went wrong.",
        upgrade:
          apiErr?.code === "account_limit" || apiErr?.code === "no_points",
      });
    } finally {
      setBusy(false);
    }
  }

  async function remove(c: Competitor) {
    const ok = window.confirm(
      `Stop tracking @${c.username}? Points spent adding it are not refunded, and adding it again costs points again. Reels you saved stay on your board.`
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

      {me && (me.user.plan === "free" || me.user.isAdmin) && (
        <CollectorCard onChange={refresh} />
      )}

      {me && limits && (
        <div className="mb-4 flex flex-wrap gap-4">
          <Meter
            label="Accounts"
            value={competitors.length}
            max={limits.maxAccounts}
          />
          <div className="sl-card px-4 py-3">
            <div className="nums text-2xl font-extrabold leading-none">
              {me.user.isAdmin ? "∞" : me.user.points}
              <span className="ml-1 text-sm font-bold text-[var(--muted)]">
                pts
              </span>
            </div>
            <div className="sl-label mt-1.5 text-[10px] text-[var(--muted)]">
              {me.user.isAdmin || me.user.ownKey
                ? "Adding accounts is free"
                : `Adding an account costs ${me.addAccountCost} pts`}
            </div>
          </div>
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
          disabled={atLimit}
          className="sl-input min-w-[260px] flex-1"
        />
        <button
          type="submit"
          disabled={busy || !input.trim() || atLimit}
          className="sl-btn sl-btn-primary"
        >
          {busy ? "Adding…" : "Track account"}
        </button>
        {atLimit && (
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
        <div className="sl-card overflow-x-auto">
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
                          title="We're collecting this account's reels now"
                        >
                          collecting
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
        {label} tracked
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
