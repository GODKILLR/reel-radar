"use client";

/**
 * Only rendered as a no-op when no password is configured, since the middleware
 * leaves everything open in that case and there is no session to end.
 */
export default function SignOut() {
  async function signOut() {
    await fetch("/api/auth", { method: "DELETE" });
    window.location.href = "/login";
  }

  return (
    <button
      type="button"
      onClick={signOut}
      className="ml-auto rounded-md px-2.5 py-1 text-xs text-[var(--muted)] transition hover:bg-[var(--surface-2)] hover:text-[var(--fg)]"
    >
      Sign out
    </button>
  );
}
