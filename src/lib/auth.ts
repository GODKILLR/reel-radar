/**
 * Signed session cookies for user accounts.
 *
 * The cookie is `<userId>.<expiresAt>.<hmac>`. It is stateless on purpose: the
 * edge middleware cannot query Postgres, and verifying a signature is all it
 * needs to decide "send them to /login or let them through". Route handlers
 * then load the real user row, so a deleted account stops working immediately.
 *
 * Runs in the edge middleware, so it uses Web Crypto rather than node:crypto.
 * Password hashing (node-only) lives in password.ts.
 */

export const SESSION_COOKIE = "rr_session";
const SESSION_DAYS = 30;

function keyMaterial(): string {
  // Fail closed: with no key configured nothing can be signed or verified.
  const key = process.env.AUTH_SECRET || process.env.WEBHOOK_SECRET || "";
  if (!key) throw new Error("AUTH_SECRET (or WEBHOOK_SECRET) is not set");
  return key;
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

export async function createSessionValue(userId: number): Promise<string> {
  const expires = Date.now() + SESSION_DAYS * 86_400_000;
  const payload = `${userId}.${expires}`;
  return `${payload}.${await hmac(payload)}`;
}

/** Returns the user id if the cookie is genuine and unexpired, else null. */
export async function readSession(
  value: string | undefined
): Promise<number | null> {
  if (!value) return null;

  const parts = value.split(".");
  if (parts.length !== 3) return null;
  const [uid, expires, signature] = parts;

  if (!/^\d{1,12}$/.test(uid) || !/^\d{10,16}$/.test(expires)) return null;
  if (Number(expires) < Date.now()) return null;

  try {
    const expected = await hmac(`${uid}.${expires}`);
    return timingSafeEqual(signature, expected) ? Number(uid) : null;
  } catch {
    return null;
  }
}

export async function isValidSession(
  value: string | undefined
): Promise<boolean> {
  return (await readSession(value)) !== null;
}

export const SESSION_MAX_AGE = SESSION_DAYS * 86_400;
