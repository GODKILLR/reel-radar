"use client";

import type { Competitor, SortKey } from "@/lib/types";

export interface Filters {
  sort: SortKey;
  competitorId: string;
  days: string;
  type: "all" | "reels";
  outliersOnly: boolean;
  watchlistOnly: boolean;
  q: string;
}

const SORT_OPTIONS: { value: SortKey; label: string; hint: string }[] = [
  { value: "recent", label: "Newest first", hint: "Most recently posted" },
  { value: "views", label: "Most views", hint: "Highest absolute view count" },
  {
    value: "velocity",
    label: "Fastest growing",
    hint: "Views gained per hour since the last check",
  },
  {
    value: "outlier",
    label: "Biggest outlier",
    hint: "Views relative to that account's own median",
  },
  { value: "likes", label: "Most likes", hint: "Highest like count" },
  {
    value: "engagement",
    label: "Best engagement",
    hint: "(likes + comments) per view",
  },
  { value: "oldest", label: "Oldest first", hint: "Earliest posted" },
];

const DAY_OPTIONS = [
  { value: "all", label: "All time" },
  { value: "1", label: "Last 24h" },
  { value: "7", label: "Last 7 days" },
  { value: "30", label: "Last 30 days" },
  { value: "90", label: "Last 90 days" },
];

interface Props {
  filters: Filters;
  competitors: Competitor[];
  total: number;
  loading: boolean;
  onChange: (patch: Partial<Filters>) => void;
}

export default function Toolbar({
  filters,
  competitors,
  total,
  loading,
  onChange,
}: Props) {
  const activeSort = SORT_OPTIONS.find((s) => s.value === filters.sort);

  return (
    <div className="mb-4 flex flex-col gap-3 rounded-xl border bg-[var(--surface)] p-3">
      <div className="flex flex-wrap items-center gap-2">
        <input
          type="search"
          value={filters.q}
          onChange={(e) => onChange({ q: e.target.value })}
          placeholder="Search captions or handles…"
          className="min-w-[200px] flex-1 rounded-md border bg-[var(--surface-2)] px-3 py-1.5 text-sm outline-none placeholder:text-[var(--muted)] focus:border-[var(--accent)]"
        />

        <Select
          label="Sort"
          value={filters.sort}
          onChange={(v) => onChange({ sort: v as SortKey })}
          title={activeSort?.hint}
          options={SORT_OPTIONS.map((s) => ({
            value: s.value,
            label: s.label,
          }))}
        />

        <Select
          label="Account"
          value={filters.competitorId}
          onChange={(v) => onChange({ competitorId: v })}
          options={[
            { value: "all", label: "All accounts" },
            ...competitors.map((c) => ({
              value: String(c.id),
              label: `@${c.username}`,
            })),
          ]}
        />

        <Select
          label="Period"
          value={filters.days}
          onChange={(v) => onChange({ days: v })}
          options={DAY_OPTIONS}
        />
      </div>

      <div className="flex flex-wrap items-center gap-2 text-sm">
        <Toggle
          active={filters.type === "reels"}
          onClick={() =>
            onChange({ type: filters.type === "reels" ? "all" : "reels" })
          }
        >
          Reels only
        </Toggle>
        <Toggle
          active={filters.outliersOnly}
          onClick={() => onChange({ outliersOnly: !filters.outliersOnly })}
          title="Posts whose views are at least 3x the account's own median"
        >
          🔥 Outliers
        </Toggle>
        <Toggle
          active={filters.watchlistOnly}
          onClick={() => onChange({ watchlistOnly: !filters.watchlistOnly })}
        >
          ★ Saved
        </Toggle>

        <span className="nums ml-auto text-xs text-[var(--muted)]">
          {loading ? "loading…" : `${total.toLocaleString()} posts`}
        </span>
      </div>
    </div>
  );
}

function Select({
  label,
  value,
  onChange,
  options,
  title,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
  title?: string;
}) {
  return (
    <label className="flex items-center gap-1.5 text-xs text-[var(--muted)]">
      <span className="sr-only sm:not-sr-only">{label}</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        title={title}
        className="rounded-md border bg-[var(--surface-2)] px-2 py-1.5 text-sm text-[var(--fg)] outline-none focus:border-[var(--accent)]"
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}

function Toggle({
  active,
  onClick,
  children,
  title,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
  title?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      title={title}
      className={`rounded-md border px-2.5 py-1 text-xs font-medium transition ${
        active
          ? "border-[var(--accent)] bg-[var(--accent)] text-white"
          : "text-[var(--muted)] hover:border-[var(--accent)] hover:text-[var(--fg)]"
      }`}
    >
      {children}
    </button>
  );
}
