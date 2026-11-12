"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { api, postJson } from "@/lib/client";

interface Info {
  enabled: boolean;
  connected: boolean;
  last4: string | null;
  status: "ok" | "out_of_credit" | "invalid" | null;
  creditLeftUsd: number | null;
  resetsAt: string | null;
}

/**
 * Lets a Free user collect on their own free Apify credit instead of ours,
 * which unlocks up to 30 accounts. The key is sent once, stored encrypted, and
 * never shown again - only its last four characters.
 */
export default function CollectorCard({ onChange }: { onChange?: () => void }) {
  const [info, setInfo] = useState<Info | null>(null);
  const [token, setToken] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setInfo(await api<Info>("/api/collector"));
    } catch {
      setInfo(null);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function connect(e: React.FormEvent) {
    e.preventDefault();
    if (busy || !token.trim()) return;
    setBusy(true);
    setError(null);
    try {
      setInfo(await postJson<Info>("/api/collector", { token: token.trim() }));
      setToken(""); // never keep the secret in the page once it is sent
      onChange?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not connect.");
    } finally {
      setBusy(false);
    }
  }

  async function test() {
    setBusy(true);
    setError(null);
    try {
      setInfo(await postJson<Info>("/api/collector/refresh", {}));
      onChange?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not check the key.");
    } finally {
      setBusy(false);
    }
  }

  async function disconnect() {
    if (!window.confirm("Disconnect your key? Your accounts stay, but we stop collecting on your credit.")) return;
    setBusy(true);
    setError(null);
    try {
      await api("/api/collector", { method: "DELETE" });
      await load();
      onChange?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not disconnect.");
    } finally {
      setBusy(false);
    }
  }

  // Feature switched off on the server: say nothing rather than tease it.
  if (!info || !info.enabled) return null;

  const resets = info.resetsAt
    ? new Date(info.resetsAt).toLocaleDateString(undefined, {
        month: "short",
        day: "numeric",
      })
    : null;

  // ---- connected and healthy ----
  if (info.connected && info.status === "ok") {
    return (
      <div className="sl-card mb-6 flex flex-wrap items-center justify-between gap-4 p-5" style={{ background: "var(--cool)" }}>
        <div>
          <p className="sl-label text-[10px]">
            <span aria-hidden>●</span> Your own key · connected
          </p>
          <p className="mt-1 text-lg font-extrabold">
            Collecting on your Apify credit
          </p>
          <p className="mt-0.5 text-sm font-semibold">
            Key ending ••••{info.last4}
            {info.creditLeftUsd !== null && (
              <>
                {" "}
                · <span className="nums">${info.creditLeftUsd.toFixed(2)}</span>{" "}
                credit left{resets ? `, renews ${resets}` : ""}
              </>
            )}
          </p>
        </div>
        <div className="flex gap-2">
          <button type="button" className="sl-btn sl-btn-sm" disabled={busy} onClick={test}>
            Test key
          </button>
          <button type="button" className="sl-btn sl-btn-sm" disabled={busy} onClick={disconnect}>
            Disconnect
          </button>
        </div>
        {error && (
          <p role="alert" className="w-full text-sm font-bold">
            {error}
          </p>
        )}
      </div>
    );
  }

  // ---- connected but paused ----
  if (info.connected && info.status === "out_of_credit") {
    return (
      <div className="sl-card mb-6 p-5" style={{ background: "var(--warm)" }}>
        <p className="sl-label text-[10px]">Your own key · paused</p>
        <p className="mt-1 text-lg font-extrabold">Your Apify credit has run out</p>
        <p className="mt-1 text-sm font-semibold">
          Collection resumes by itself when your credit renews
          {resets ? ` on ${resets}` : ""}. Your existing reels stay visible.
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          <button type="button" className="sl-btn sl-btn-sm" disabled={busy} onClick={test}>
            Check again
          </button>
          <Link href="/account" className="sl-btn sl-btn-sm">
            See managed plans
          </Link>
          <button type="button" className="sl-btn sl-btn-sm" disabled={busy} onClick={disconnect}>
            Disconnect
          </button>
        </div>
        {error && (
          <p role="alert" className="mt-2 text-sm font-bold">
            {error}
          </p>
        )}
      </div>
    );
  }

  // ---- not connected, or key no longer works ----
  const broken = info.connected && info.status === "invalid";
  return (
    <form onSubmit={connect} className="sl-card sl-halftone mb-6 p-5" style={{ background: "var(--dark)", color: "#fff" }}>
      <p className="sl-label text-[10px] text-white/80">
        <span style={{ color: "var(--hot)" }}>●</span>{" "}
        {broken ? "Your key stopped working" : "Step 1 · connect your key"}
      </p>
      <h2 className="mt-1 text-2xl font-extrabold leading-tight">
        {broken ? (
          <>
            Reconnect to <span className="sl-kw">resume.</span>
          </>
        ) : (
          <>
            Connect your key to start <span className="sl-kw">tracking.</span>
          </>
        )}
      </h2>
      <ol className="mt-3 list-decimal space-y-1 pl-5 text-sm text-white/85">
        <li>
          Create a free account at{" "}
          <a href="https://console.apify.com/sign-up" target="_blank" rel="noopener noreferrer" className="font-bold underline">
            apify.com
          </a>
          .
        </li>
        <li>
          Open{" "}
          <a href="https://console.apify.com/settings/integrations" target="_blank" rel="noopener noreferrer" className="font-bold underline">
            Settings → API &amp; Integrations
          </a>{" "}
          and copy your personal API token.
        </li>
        <li>Paste it here.</li>
      </ol>

      <div className="mt-4 flex flex-wrap gap-3">
        <input
          type="password"
          value={token}
          onChange={(e) => setToken(e.target.value)}
          placeholder="Paste your API token"
          aria-label="Apify API token"
          autoComplete="off"
          spellCheck={false}
          className="sl-input min-w-[260px] flex-1"
          style={{ color: "var(--ink)" }}
        />
        <button type="submit" disabled={busy || !token.trim()} className="sl-btn">
          {busy ? "Checking…" : "Connect"}
        </button>
        {broken && (
          <button type="button" className="sl-btn" disabled={busy} onClick={disconnect}>
            Remove old key
          </button>
        )}
      </div>

      {error && (
        <p role="alert" className="mt-3 text-sm font-bold" style={{ color: "var(--warm)" }}>
          {error}
        </p>
      )}

      <p className="mt-3 text-xs text-white/65">
        A free Apify account includes monthly usage credit (about $5 at the time
        of writing), which covers roughly 30 accounts at a daily refresh.
        Collection runs on that credit, not ours. We use the key only to
        collect public reel data for the accounts you track. It is stored
        encrypted, never shown again, and you can disconnect any time.
      </p>
    </form>
  );
}
