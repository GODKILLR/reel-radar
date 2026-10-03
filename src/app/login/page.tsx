"use client";

import { useState } from "react";

export default function LoginPage() {
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);

    try {
      const res = await fetch("/api/auth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Sign in failed.");

      // Read the redirect target here rather than during render, so the page
      // stays a static shell.
      const next = new URLSearchParams(window.location.search).get("next");
      window.location.href = next && next.startsWith("/") ? next : "/";
    } catch (err) {
      setError(err instanceof Error ? err.message : "Sign in failed.");
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto mt-24 max-w-sm">
      <form
        onSubmit={submit}
        className="rounded-xl border bg-[var(--surface)] p-6"
      >
        <div className="mb-1 flex items-center gap-2 font-semibold">
          <span
            className="inline-block h-2.5 w-2.5 rounded-full"
            style={{ background: "var(--hot)" }}
            aria-hidden
          />
          Reel Radar
        </div>
        <p className="mb-4 text-sm text-[var(--muted)]">
          Enter the dashboard password.
        </p>

        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoFocus
          autoComplete="current-password"
          aria-label="Dashboard password"
          className="mb-3 w-full rounded-md border bg-[var(--surface-2)] px-3 py-2 text-sm outline-none focus:border-[var(--accent)]"
        />

        {error && (
          <p className="mb-3 text-sm" style={{ color: "var(--hot)" }}>
            {error}
          </p>
        )}

        <button
          type="submit"
          disabled={busy || !password}
          className="w-full rounded-md bg-[var(--accent)] px-4 py-2 text-sm font-medium text-white transition disabled:opacity-50"
        >
          {busy ? "Checking…" : "Sign in"}
        </button>
      </form>
    </div>
  );
}
