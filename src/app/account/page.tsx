"use client";

import { useEffect, useState } from "react";
import type { Me } from "@/lib/types";
import { api } from "@/lib/client";
import { relativeTime } from "@/lib/format";

const UNLIMITED = 1_000_000;
const fmt = (n: number) => (n >= UNLIMITED ? "Unlimited" : n.toLocaleString());

export default function AccountPage() {
  const [me, setMe] = useState<Me | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api<Me>("/api/me")
      .then(setMe)
      .catch((e) => setError(e instanceof Error ? e.message : "Could not load."));
  }, []);

  if (error) {
    return (
      <div className="sl-card p-6 text-sm font-semibold" role="alert">
        {error}
      </div>
    );
  }
  if (!me) return <p className="sl-label text-[var(--muted)]">loading…</p>;

  const { user, usage, ledger, plans } = me;
  const resetsIn = relativeTime(user.pointsResetAt).replace(" ago", "");

  return (
    <>
      <p className="sl-label text-[var(--muted)]">
        <span style={{ color: "var(--hot)" }}>●</span> 03 · Plan &amp; points
      </p>
      <h1 className="mt-2 text-4xl font-extrabold leading-[1.02] tracking-tight sm:text-5xl">
        You&apos;re on <span className="sl-kw">{user.planName}.</span>
      </h1>
      <p className="mb-6 mt-3 max-w-xl text-base text-[var(--muted)]">
        {user.email}
      </p>

      <div className="mb-8 grid gap-4 sm:grid-cols-3">
        <Stat
          label="Points"
          value={user.isAdmin ? "∞" : String(user.points)}
          sub={
            user.isAdmin
              ? "Unmetered"
              : `Refills to ${user.limits.monthlyPoints} on ${new Date(user.pointsResetAt).toLocaleDateString()}`
          }
          accent
        />
        <Stat
          label="Accounts tracked"
          value={`${usage.accounts} / ${user.limits.maxAccounts}`}
          sub={`Latest ${user.limits.reelsPerAccount} reels each`}
        />
        <Stat
          label="Saved ideas"
          value={
            user.limits.savedLimit >= UNLIMITED
              ? String(usage.saved)
              : `${usage.saved} / ${user.limits.savedLimit}`
          }
          sub={`Refresh about every ${user.limits.refreshHours}h`}
        />
      </div>

      <p className="sl-label mb-3 text-[var(--muted)]">
        <span style={{ color: "var(--hot)" }}>●</span> Plans
      </p>
      <div className="mb-3 grid gap-4 md:grid-cols-3">
        {plans.map((p) => {
          const current = p.id === user.plan && !user.isAdmin;
          return (
            <div
              key={p.id}
              className="sl-card p-5"
              style={current ? { background: "var(--ink)", color: "#fff" } : undefined}
            >
              <div className="flex items-center justify-between">
                <h2 className="text-2xl font-extrabold">{p.name}</h2>
                {current && (
                  <span
                    className="sl-tag"
                    style={{ background: "var(--warm)", color: "var(--ink)" }}
                  >
                    Your plan
                  </span>
                )}
              </div>
              <p
                className="mt-1 text-sm"
                style={{ opacity: current ? 0.8 : 0.65 }}
              >
                {p.blurb}
              </p>
              <ul className="mt-4 space-y-1.5 text-sm font-semibold">
                <li>{p.maxAccounts} accounts tracked</li>
                <li>Latest {p.reelsPerAccount} reels per account</li>
                <li>Refreshed about every {p.refreshHours}h</li>
                <li>Top {p.discoverLimit} in Discover</li>
                <li>
                  {p.savedLimit >= UNLIMITED
                    ? "Unlimited saved ideas"
                    : `${p.savedLimit} saved ideas`}
                </li>
                <li>{p.monthlyPoints} points / month</li>
              </ul>
              {!current && p.id !== "free" && (
                <p className="sl-label mt-4 text-[10px] opacity-65">
                  Upgrades opening soon
                </p>
              )}
            </div>
          );
        })}
      </div>
      <p className="mb-8 text-xs text-[var(--muted)]">
        Adding an account costs {me.addAccountCost} points. Points reset monthly
        (next reset in {resetsIn || "a month"}).
      </p>

      <p className="sl-label mb-3 text-[var(--muted)]">
        <span style={{ color: "var(--hot)" }}>●</span> Points history
      </p>
      {ledger.length === 0 ? (
        <div className="sl-card p-6 text-sm text-[var(--muted)]">
          No activity yet.
        </div>
      ) : (
        <div className="sl-card overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="sl-label bg-[var(--ink)] text-left text-[10px] text-white">
                <th className="px-4 py-3">What</th>
                <th className="px-4 py-3 text-right">Change</th>
                <th className="px-4 py-3 text-right">Balance</th>
                <th className="px-4 py-3 text-right">When</th>
              </tr>
            </thead>
            <tbody>
              {ledger.map((l, i) => (
                <tr key={i} className="border-b border-[var(--line)] last:border-0">
                  <td className="px-4 py-2.5 font-semibold">{l.reason}</td>
                  <td
                    className="nums px-4 py-2.5 text-right font-bold"
                    style={{ color: l.delta < 0 ? "var(--hot)" : "var(--ink)" }}
                  >
                    {l.delta > 0 ? "+" : ""}
                    {fmt(l.delta)}
                  </td>
                  <td className="nums px-4 py-2.5 text-right">{l.balance_after}</td>
                  <td className="px-4 py-2.5 text-right text-[var(--muted)]">
                    {relativeTime(l.created_at)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

function Stat({
  label,
  value,
  sub,
  accent,
}: {
  label: string;
  value: string;
  sub: string;
  accent?: boolean;
}) {
  return (
    <div
      className="sl-card sl-halftone px-5 py-4"
      style={accent ? { background: "var(--hot)", color: "#fff" } : undefined}
    >
      <div className="nums text-4xl font-extrabold leading-none tracking-tight">
        {value}
      </div>
      <div className="sl-label mt-2 text-[10px]" style={{ opacity: 0.85 }}>
        {label}
      </div>
      <div className="mt-1 text-xs" style={{ opacity: 0.75 }}>
        {sub}
      </div>
    </div>
  );
}
