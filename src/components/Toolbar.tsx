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
    <div className="sl-card mb-6 flex flex-col gap-3 p-4">
      <div className="flex flex-wrap items-end gap-3">
        <label className="flex min-w-[220px] flex-1 flex-col gap-1">
          <span className="sl-label text-[var(--muted)]">Search</span>
          <input
            type="search"
            value={filters.q}
            onChange={(e) => onChange({ q: e.target.value })}
            placeholder="Captions or handles…"
            className="sl-input"
          />
        </label>

        <Select
          label="Sort by"
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

      <div className="flex flex-wrap items-center gap-2">
        <Toggle
          active={filters.outliersOnly}
          hot
          onClick={() => onChange({ outliersOnly: !filters.outliersOnly })}
          title="Posts whose views are at least 3x the account's own median"
        >
          Outliers only
        </Toggle>
        <Toggle
          active={filters.type === "reels"}
          onClick={() =>
            onChange({ type: filters.type === "reels" ? "all" : "reels" })
          }
        >
          Reels only
        </Toggle>
        <Toggle
          active={filters.watchlistOnly}
          onClick={() => onChange({ watchlistOnly: !filters.watchlistOnly })}
        >
          ★ Saved
        </Toggle>

        <span className="sl-label nums ml-auto text-[var(--muted)]">
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
    <label className="flex flex-col gap-1">
      <span className="sl-label text-[var(--muted)]">{label}</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        title={title}
        className="sl-input cursor-pointer pr-8"
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
  hot,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
  title?: string;
  hot?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      title={title}
      className={`sl-pill ${hot ? "sl-pill-hot" : ""}`}
    >
      {children}
    </button>
  );
}
