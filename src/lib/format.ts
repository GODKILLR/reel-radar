export function compactNumber(value: number | string | null): string {
  const n = typeof value === "string" ? Number(value) : value;
  if (n === null || n === undefined || !Number.isFinite(n)) return "—";
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(n >= 10_000_000 ? 0 : 1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(n >= 100_000 ? 0 : 1)}K`;
  return String(Math.round(n));
}

export function relativeTime(iso: string | null): string {
  if (!iso) return "never";
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "—";

  const seconds = Math.round((Date.now() - then) / 1000);
  if (seconds < 60) return "just now";

  const units: [number, string][] = [
    [60, "m"],
    [3600, "h"],
    [86_400, "d"],
    [604_800, "w"],
  ];

  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86_400) return `${Math.floor(seconds / 3600)}h ago`;
  if (seconds < 604_800) return `${Math.floor(seconds / 86_400)}d ago`;
  void units;
  return `${Math.floor(seconds / 604_800)}w ago`;
}

export function duration(seconds: number | string | null): string | null {
  const n = typeof seconds === "string" ? Number(seconds) : seconds;
  if (!n || !Number.isFinite(n)) return null;
  const mins = Math.floor(n / 60);
  const secs = Math.round(n % 60);
  return `${mins}:${String(secs).padStart(2, "0")}`;
}

/** Engagement rate against views, which is the honest denominator for reels. */
export function engagementRate(
  likes: number,
  comments: number,
  views: number
): string {
  if (!views) return "—";
  return `${(((likes + comments) / views) * 100).toFixed(1)}%`;
}

/** Visual tier for an outlier multiple. */
export function heatOf(score: number | null): "hot" | "warm" | "none" {
  if (score === null || !Number.isFinite(score)) return "none";
  if (score >= 5) return "hot";
  if (score >= 3) return "warm";
  return "none";
}
