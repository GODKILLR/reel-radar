"use client";

import Link from "next/link";
import { useState } from "react";
import StarLogo from "@/components/StarLogo";
import { postJson } from "@/lib/client";

export default function AuthForm({ mode }: { mode: "login" | "signup" }) {
  const isSignup = mode === "signup";
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);

    try {
      await postJson(isSignup ? "/api/auth/signup" : "/api/auth/login", {
        email,
        password,
        ...(isSignup ? { name } : {}),
      });

      // Read the redirect target here rather than during render, so the page
      // stays a static shell. New accounts land on Discover so there is
      // something good to look at before they track anything.
      const next = new URLSearchParams(window.location.search).get("next");
      window.location.href =
        next && next.startsWith("/") && !next.startsWith("//")
          ? next
          : isSignup
            ? "/discover"
            : "/";
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto mt-8 max-w-md sm:mt-16">
      <form onSubmit={submit} className="sl-card p-7">
        <StarLogo />
        <p className="sl-label mt-5 text-[var(--muted)]">
          <span style={{ color: "var(--hot)" }}>●</span> Reel Radar
        </p>
        <h1 className="mt-1 text-3xl font-extrabold leading-[1.05] tracking-tight">
          {isSignup ? (
            <>
              Find the reels that <span className="sl-kw">break</span> the
              pattern.
            </>
          ) : (
            <>
              Welcome <span className="sl-kw">back.</span>
            </>
          )}
        </h1>
        <p className="mb-5 mt-3 text-sm text-[var(--muted)]">
          {isSignup
            ? "Create a free account. Track 3 accounts, see their top reels, and start with 50 points."
            : "Log in to your outlier feed."}
        </p>

        {isSignup && (
          <label className="mb-3 block">
            <span className="sl-label text-[var(--muted)]">Name (optional)</span>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              autoComplete="name"
              className="sl-input mt-1 w-full"
            />
          </label>
        )}

        <label className="mb-3 block">
          <span className="sl-label text-[var(--muted)]">Email</span>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            autoFocus
            autoComplete="email"
            className="sl-input mt-1 w-full"
          />
        </label>

        <label className="mb-4 block">
          <span className="sl-label text-[var(--muted)]">Password</span>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            minLength={isSignup ? 8 : undefined}
            autoComplete={isSignup ? "new-password" : "current-password"}
            placeholder={isSignup ? "At least 8 characters" : undefined}
            className="sl-input mt-1 w-full"
          />
        </label>

        {error && (
          <p
            role="alert"
            className="mb-3 text-sm font-semibold"
            style={{ color: "var(--hot)" }}
          >
            {error}
          </p>
        )}

        <button
          type="submit"
          disabled={busy || !email || !password}
          className="sl-btn sl-btn-primary w-full"
        >
          {busy
            ? "One moment…"
            : isSignup
              ? "Create free account →"
              : "Log in →"}
        </button>

        <p className="mt-4 text-center text-sm text-[var(--muted)]">
          {isSignup ? (
            <>
              Already have an account?{" "}
              <Link href="/login" className="font-bold text-[var(--ink)] underline">
                Log in
              </Link>
            </>
          ) : (
            <>
              New here?{" "}
              <Link href="/signup" className="font-bold text-[var(--ink)] underline">
                Create a free account
              </Link>
            </>
          )}
        </p>
      </form>
    </div>
  );
}
