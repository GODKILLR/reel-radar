"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import type { Me } from "@/lib/types";
import { api } from "@/lib/client";

export default function PlanPage() {
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

  const { user, usage, plans } = me;

  return (
    <>
      <p className="sl-label text-[var(--muted)]">
        <span style={{ color: "var(--hot)" }}>●</span> 03 · Plan
      </p>
      <h1 className="mt-2 text-4xl font-extrabold leading-[1.02] tracking-tight sm:text-5xl">
        You&apos;re on <span className="sl-kw">{user.planName}.</span>
      </h1>
      <p className="mb-6 mt-3 max-w-xl text-base text-[var(--muted)]">
        {user.email}
      </p>

      <div className="mb-8 grid gap-4 sm:grid-cols-2">
        <div className="sl-card sl-halftone px-5 py-4" style={{ background: "var(--hot)", color: "#fff" }}>
          <div className="nums text-4xl font-extrabold leading-none tracking-tight">
            {usage.accounts} / {user.limits.maxAccounts}
          </div>
          <div className="sl-label mt-2 text-[10px]" style={{ opacity: 0.9 }}>
            Accounts tracked
          </div>
          <div className="mt-1 text-xs" style={{ opacity: 0.8 }}>
            Latest {user.limits.reelsPerAccount} reels each, refreshed about every {user.limits.refreshHours}h
          </div>
        </div>

        <div className="sl-card px-5 py-4">
          <div className="text-2xl font-extrabold leading-tight">
            {user.isAdmin
              ? "Admin"
              : user.collectorStatus === "ok"
                ? "Key connected"
                : user.collectorStatus === "out_of_credit"
                  ? "Key out of credit"
                  : user.collectorStatus === "invalid"
                    ? "Key stopped working"
                    : "No key yet"}
          </div>
          <div className="sl-label mt-2 text-[10px] text-[var(--muted)]">
            Collection key
          </div>
          <div className="mt-1 text-sm text-[var(--muted)]">
            {user.canCollect ? (
              <>Collecting runs on your own Apify credit.</>
            ) : (
              <>
                Connect your key on the{" "}
                <Link href="/competitors" className="font-bold text-[var(--ink)] underline">
                  Accounts
                </Link>{" "}
                page to start tracking.
              </>
            )}
          </div>
        </div>
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
              <p className="mt-2">
                <span className="nums text-4xl font-extrabold tracking-tight">
                  {p.priceUsd === 0 ? "Free" : `$${p.priceUsd}`}
                </span>
                {p.priceUsd > 0 && (
                  <span className="ml-1 text-sm font-bold" style={{ opacity: 0.7 }}>
                    / month
                  </span>
                )}
              </p>
              <p className="mt-3 text-lg font-extrabold">
                Track up to <span className="sl-kw" style={{ color: current ? "var(--warm)" : undefined }}>{p.maxAccounts}</span> accounts
              </p>
              <p className="mt-1 text-sm" style={{ opacity: current ? 0.8 : 0.65 }}>
                {p.blurb}
              </p>
              {!current && p.priceUsd > 0 && (
                <p className="sl-label mt-4 text-[10px] opacity-65">
                  Upgrades opening soon
                </p>
              )}
            </div>
          );
        })}
      </div>
      <p className="text-xs text-[var(--muted)]">
        Every plan uses your own Apify key for collection, so the plan only sets
        how many accounts you can track. Latest {user.limits.reelsPerAccount} reels
        per account, refreshed daily.
      </p>
    </>
  );
}
