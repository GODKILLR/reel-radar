/**
 * Single-password gate for the dashboard.
 *
 * The app is a private research tool with no multi-user story, so a shared
 * password is the right weight: it keeps the deployment off the open internet
 * without dragging in an auth provider. The cookie carries an expiry and an
 * HMAC over it, so it cannot be forged or replayed past its lifetime.
 *
 * Runs in the edge middleware, so it uses Web Crypto rather than node:crypto.
 */

export const SESSION_COOKIE = "rr_session";
const SESSION_DAYS = 30;

function keyMaterial(): string {
  // Reuse WEBHOOK_SECRET as the signing key; it is already a 32-byte random
  // value present in every environment. Falls back to the password itself so a
  // misconfigured deploy fails closed rather than signing with an empty key.
  return process.env.WEBHOOK_SECRET || process.env.DASHBOARD_PASSWORD || "";
}

async function hmac(message: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(keyMaterial()),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(message));
  return [...new Uint8Array(sig)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/** Constant-time comparison, so a wrong guess leaks nothing via timing. */
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

export async function createSessionValue(): Promise<string> {
  const expires = Date.now() + SESSION_DAYS * 86_400_000;
  return `${expires}.${await hmac(String(expires))}`;
}

export async function isValidSession(
  value: string | undefined
): Promise<boolean> {
  if (!value) return false;

  const sep = value.lastIndexOf(".");
  if (sep <= 0) return false;

  const expires = value.slice(0, sep);
  const signature = value.slice(sep + 1);

  const expiresAt = Number(expires);
  if (!Number.isFinite(expiresAt) || expiresAt < Date.now()) return false;

  return timingSafeEqual(signature, await hmac(expires));
}

/** Whether a password gate is configured at all. */
export function isAuthEnabled(): boolean {
  return Boolean(process.env.DASHBOARD_PASSWORD);
}

export async function checkPassword(candidate: string): Promise<boolean> {
  const expected = process.env.DASHBOARD_PASSWORD ?? "";
  if (!expected) return false;
  // Hash both sides first so the comparison length does not reveal the
  // password length.
  return timingSafeEqual(await hmac(`pw:${candidate}`), await hmac(`pw:${expected}`));
}

export const SESSION_MAX_AGE = SESSION_DAYS * 86_400;
