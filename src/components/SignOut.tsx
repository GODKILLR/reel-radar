"use client";

export default function SignOut() {
  async function signOut() {
    await fetch("/api/auth/logout", { method: "POST" });
    window.location.href = "/login";
  }

  return (
    <button
      type="button"
      onClick={signOut}
      className="sl-label rounded-md px-2 py-1 text-[var(--muted)] transition hover:text-[var(--ink)]"
    >
      Sign out
    </button>
  );
}
