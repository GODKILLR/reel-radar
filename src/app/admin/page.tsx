"use client";

import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/client";
import { relativeTime } from "@/lib/format";

interface Overview {
  users: {
    id: string;
    email: string;
    name: string | null;
    plan: string;
    points: number;
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

      {error && (
        <div
          role="alert"
          className="sl-card mt-4 p-3 text-sm font-semibold"
          style={{ background: "var(--hot)", color: "#fff" }}
        >
          {error}
        </div>
      )}

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
              <th className="px-4 py-3 text-right">Points</th>
              <th className="px-4 py-3 text-right">Accounts</th>
              <th className="px-4 py-3 text-right">Joined</th>
              <th className="px-4 py-3 text-right">Grant points</th>
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
                    <option value="free">Free</option>
                    <option value="pro">Pro</option>
                    <option value="studio">Studio</option>
                  </select>
                </td>
                <td className="nums px-4 py-2.5 text-right">{u.points}</td>
                <td className="nums px-4 py-2.5 text-right">{u.accounts}</td>
                <td className="px-4 py-2.5 text-right text-[var(--muted)]">
                  {relativeTime(u.created_at)}
                </td>
                <td className="px-4 py-2.5 text-right">
                  <div className="flex justify-end gap-1.5">
                    {[50, 100].map((n) => (
                      <button
                        key={n}
                        type="button"
                        className="sl-btn sl-btn-sm"
                        onClick={() =>
                          patch(`/api/admin/users/${u.id}`, { pointsDelta: n })
                        }
                      >
                        +{n}
                      </button>
                    ))}
                  </div>
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
