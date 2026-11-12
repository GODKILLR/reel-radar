"use client";

import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/client";
import { relativeTime } from "@/lib/format";

interface Overview {
  storage: {
    dbMb: number;
    limitMb: number;
    percentFull: number;
    cleanupAtPercent: number;
    orphanDays: number;
    inactiveDays: number;
    lastCleanupAt: string | null;
    lastReport: {
      deleting: boolean;
      accountsDue: number;
      accountsDeleted: number;
      inactiveUsers: number;
      trackingLinksRemoved: number;
      postsTrimmed: number;
      metricsPruned: number;
      error?: string;
    } | null;
  };
  users: {
    id: string;
    email: string;
    name: string | null;
    plan: string;
    is_admin: boolean;
    created_at: string;
    last_login_at: string | null;
    accounts: string;
    has_key: boolean;
    collector_status: string | null;
  }[];
  competitors: {
    id: number;
    username: string;
    is_active: boolean;
    is_curated: boolean;
    last_scraped_at: string | null;
    post_count: number;
    trackers: string;
  }[];
  spend: { last_24h: string; last_30d: string } | null;
  runs: {
    tier: string;
    status: string;
    posts_seen: number;
    posts_new: number;
    cost_usd: string;
    started_at: string;
    error: string | null;
  }[];
  plans: { plan: string; n: string }[];
  collector: { label: string; costPerPostUsd: number };
}

/**
 * Operator-only. This is the one page where collection cost and vendor detail
 * appear; the API behind it returns 404 to everyone who is not an admin.
 */
export default function AdminPage() {
  const [data, setData] = useState<Overview | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setData(await api<Overview>("/api/admin/overview"));
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load.");
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function patch(url: string, body: unknown) {
    try {
      await api(url, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Update failed.");
    }
  }

  if (error && !data) {
    return (
      <div className="sl-card p-6 text-sm font-semibold" role="alert">
        {error}
      </div>
    );
  }
  if (!data) return <p className="sl-label text-[var(--muted)]">loading…</p>;

  return (
    <>
      <p className="sl-label text-[var(--muted)]">
        <span style={{ color: "var(--hot)" }}>●</span> Admin · not visible to users
      </p>
      <h1 className="mt-2 text-4xl font-extrabold leading-[1.02] tracking-tight sm:text-5xl">
        Operations <span className="sl-kw">desk.</span>
      </h1>

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <button
          type="button"
          className="sl-btn sl-btn-primary"
          onClick={async () => {
            try {
              const r = await api<{ launched: { tier: string; accounts: number }[] }>(
                "/api/admin/collect",
                { method: "POST" }
              );
              setError(
                r.launched.length
                  ? `Started: ${r.launched.map((l) => `${l.tier} (${l.accounts})`).join(", ")}`
                  : "Nothing due for featured accounts."
              );
              await load();
            } catch (err) {
              setError(err instanceof Error ? err.message : "Could not start.");
            }
          }}
        >
          Collect featured accounts now
        </button>
        <span className="text-xs text-[var(--muted)]">
          Runs on our key. Never touches any user&apos;s key.
        </span>
      </div>

      {error && (
        <div
          role="alert"
          className="sl-card mt-4 p-3 text-sm font-semibold"
          style={{ background: "var(--hot)", color: "#fff" }}
        >
          {error}
        </div>
      )}

      <div className="sl-card mt-6 p-4">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <span className="sl-label text-[var(--muted)]">Database</span>
          <span className="nums text-sm font-bold">
            {data.storage.dbMb} MB of {data.storage.limitMb} MB ({data.storage.percentFull}%)
          </span>
        </div>
        <div
          className="mt-2 h-3 overflow-hidden rounded-full border-2"
          role="progressbar"
          aria-valuenow={Math.round(data.storage.percentFull)}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label="Database size"
        >
          <div
            className="h-full"
            style={{
              width: `${Math.min(100, data.storage.percentFull)}%`,
              background:
                data.storage.percentFull >= data.storage.cleanupAtPercent
                  ? "var(--hot)"
                  : "var(--cool)",
            }}
          />
        </div>
        <p className="mt-2 text-xs text-[var(--muted)]">
          Clean-up runs about daily. Above {data.storage.cleanupAtPercent}% it deletes accounts
          nobody has tracked for {data.storage.orphanDays} days and drops the tracking of users
          unseen for {data.storage.inactiveDays} days (their email and saved ideas stay).
          {data.storage.lastReport
            ? ` Last run ${relativeTime(data.storage.lastCleanupAt)}: ${
                data.storage.lastReport.error
                  ? `failed (${data.storage.lastReport.error})`
                  : `${data.storage.lastReport.deleting ? "deleted" : "would delete"} ${
                      data.storage.lastReport.deleting
                        ? data.storage.lastReport.accountsDeleted
                        : data.storage.lastReport.accountsDue
                    } account(s) and ${
                      data.storage.lastReport.deleting
                        ? data.storage.lastReport.trackingLinksRemoved
                        : data.storage.lastReport.inactiveUsers
                    } inactive user link set(s); trimmed ${data.storage.lastReport.postsTrimmed} old reels.`
              }`
            : " Has not run yet."}
        </p>
      </div>

      <div className="my-6 grid gap-4 sm:grid-cols-4">
        <Stat label="Users" value={String(data.users.length)} />
        <Stat
          label="Collection spend 24h"
          value={`$${Number(data.spend?.last_24h ?? 0).toFixed(2)}`}
        />
        <Stat
          label="Collection spend 30d"
          value={`$${Number(data.spend?.last_30d ?? 0).toFixed(2)}`}
        />
        <Stat
          label={`Collector · $${data.collector.costPerPostUsd}/post`}
          value={data.collector.label}
        />
      </div>

      <Section title="Discover & tracked accounts">
        <table className="w-full text-sm">
          <thead>
            <tr className="sl-label bg-[var(--ink)] text-left text-[10px] text-white">
              <th className="px-4 py-3">Account</th>
              <th className="px-4 py-3 text-right">Trackers</th>
              <th className="px-4 py-3 text-right">Posts</th>
              <th className="px-4 py-3 text-right">Updated</th>
              <th className="px-4 py-3 text-right">Featured in Discover</th>
              <th className="px-4 py-3 text-right">Collecting</th>
            </tr>
          </thead>
          <tbody>
            {data.competitors.map((c) => (
              <tr key={c.id} className="border-b border-[var(--line)] last:border-0">
                <td className="px-4 py-2.5 font-bold">@{c.username}</td>
                <td className="nums px-4 py-2.5 text-right">{c.trackers}</td>
                <td className="nums px-4 py-2.5 text-right">{c.post_count}</td>
                <td className="px-4 py-2.5 text-right text-[var(--muted)]">
                  {relativeTime(c.last_scraped_at)}
                </td>
                <td className="px-4 py-2.5 text-right">
                  <button
                    type="button"
                    aria-pressed={c.is_curated}
                    className="sl-pill"
                    onClick={() =>
                      patch(`/api/admin/competitors/${c.id}`, {
                        is_curated: !c.is_curated,
                      })
                    }
                  >
                    {c.is_curated ? "Featured" : "Off"}
                  </button>
                </td>
                <td className="px-4 py-2.5 text-right">
                  <button
                    type="button"
                    aria-pressed={c.is_active}
                    className="sl-pill"
                    onClick={() =>
                      patch(`/api/admin/competitors/${c.id}`, {
                        is_active: !c.is_active,
                      })
                    }
                  >
                    {c.is_active ? "On" : "Paused"}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Section>

      <Section title="Users">
        <table className="w-full text-sm">
          <thead>
            <tr className="sl-label bg-[var(--ink)] text-left text-[10px] text-white">
              <th className="px-4 py-3">Email</th>
              <th className="px-4 py-3">Plan</th>
              <th className="px-4 py-3 text-right">Accounts</th>
              <th className="px-4 py-3 text-right">Joined</th>
            </tr>
          </thead>
          <tbody>
            {data.users.map((u) => (
              <tr key={u.id} className="border-b border-[var(--line)] last:border-0">
                <td className="px-4 py-2.5 font-semibold">
                  {u.email}
                  {u.is_admin && (
                    <span className="sl-tag ml-2" style={{ background: "var(--warm)" }}>
                      admin
                    </span>
                  )}
                  {u.has_key && (
                    <span
                      className="sl-tag ml-2"
                      style={{
                        background:
                          u.collector_status === "ok" ? "var(--cool)" : "var(--hot)",
                        color: u.collector_status === "ok" ? "var(--ink)" : "#fff",
                      }}
                      title="Collects on their own key"
                    >
                      own key · {u.collector_status ?? "?"}
                    </span>
                  )}
                </td>
                <td className="px-4 py-2.5">
                  <select
                    value={u.plan}
                    aria-label={`Plan for ${u.email}`}
                    onChange={(e) =>
                      patch(`/api/admin/users/${u.id}`, { plan: e.target.value })
                    }
                    className="sl-input py-1 text-xs"
                  >
                    <option value="free">Free · 10</option>
                    <option value="pro">Pro · 20</option>
                    <option value="ultra">Ultra · 100</option>
                  </select>
                </td>
                <td className="nums px-4 py-2.5 text-right">{u.accounts}</td>
                <td className="px-4 py-2.5 text-right text-[var(--muted)]">
                  {relativeTime(u.created_at)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Section>

      <Section title="Recent collection runs">
        <table className="w-full text-sm">
          <thead>
            <tr className="sl-label bg-[var(--ink)] text-left text-[10px] text-white">
              <th className="px-4 py-3">Tier</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3 text-right">Seen</th>
              <th className="px-4 py-3 text-right">New</th>
              <th className="px-4 py-3 text-right">Cost</th>
              <th className="px-4 py-3 text-right">Started</th>
            </tr>
          </thead>
          <tbody>
            {data.runs.map((r, i) => (
              <tr key={i} className="border-b border-[var(--line)] last:border-0">
                <td className="px-4 py-2.5 font-semibold">{r.tier}</td>
                <td className="px-4 py-2.5" title={r.error ?? undefined}>
                  {r.status}
                  {r.error ? ` · ${r.error.slice(0, 60)}` : ""}
                </td>
                <td className="nums px-4 py-2.5 text-right">{r.posts_seen}</td>
                <td className="nums px-4 py-2.5 text-right">{r.posts_new}</td>
                <td className="nums px-4 py-2.5 text-right">
                  ${Number(r.cost_usd).toFixed(4)}
                </td>
                <td className="px-4 py-2.5 text-right text-[var(--muted)]">
                  {relativeTime(r.started_at)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Section>
    </>
  );
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="mb-8">
      <p className="sl-label mb-3 text-[var(--muted)]">
        <span style={{ color: "var(--hot)" }}>●</span> {title}
      </p>
      <div className="sl-card overflow-x-auto">{children}</div>
    </section>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="sl-card px-4 py-3">
      <div className="nums text-2xl font-extrabold leading-none">{value}</div>
      <div className="sl-label mt-1.5 text-[10px] text-[var(--muted)]">
        {label}
      </div>
    </div>
  );
}
