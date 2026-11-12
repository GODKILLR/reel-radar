/**
 * "Connect your own collector": users may supply their own API token so their
 * accounts are collected on their own free monthly credit, not ours.
 *
 * Security rules for this file:
 *  - tokens are encrypted at rest (AES-256-GCM) and bound to the user id, so a
 *    ciphertext copied onto another user's row cannot be decrypted;
 *  - decrypted tokens exist only in memory for the duration of one request or
 *    poll, and are never logged or returned to the browser;
 *  - with no KEY_ENCRYPTION_SECRET the feature is simply off (fails closed).
 *
 * Node runtime only.
 */
import crypto from "node:crypto";
import { apiBase } from "./apify";
import { query, queryOne } from "./db";

export type CollectorStatus = "ok" | "out_of_credit" | "invalid";

/** Below this much credit left, a collector is treated as out of credit. */
export const MIN_CREDIT_USD = 0.05;

const TOKEN_RE = /^[A-Za-z0-9_-]{20,200}$/;

export function looksLikeToken(value: unknown): value is string {
  return typeof value === "string" && TOKEN_RE.test(value.trim());
}

// ---------- encryption ----------

function secretKey(): Buffer | null {
  const secret = process.env.KEY_ENCRYPTION_SECRET ?? "";
  if (secret.length < 32) return null;
  return crypto.createHash("sha256").update(secret).digest();
}

export function encryptionEnabled(): boolean {
  return secretKey() !== null;
}

/** `v1.<iv>.<tag>.<ciphertext>`, all base64url. */
export function encryptToken(token: string, userId: number): string {
  const key = secretKey();
  if (!key) throw new Error("KEY_ENCRYPTION_SECRET is not set");

  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(Buffer.from(`user:${userId}`));
  const ct = Buffer.concat([cipher.update(token, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return ["v1", iv, tag, ct].map((p) => (typeof p === "string" ? p : p.toString("base64url"))).join(".");
}

/** Returns null on ANY failure (wrong user, tampering, wrong secret, no key). */
export function decryptToken(blob: string | null, userId: number): string | null {
  const key = secretKey();
  if (!key || !blob) return null;
  try {
    const [v, iv, tag, ct] = blob.split(".");
    if (v !== "v1" || !iv || !tag || !ct) return null;
    const decipher = crypto.createDecipheriv(
      "aes-256-gcm",
      key,
      Buffer.from(iv, "base64url")
    );
    decipher.setAAD(Buffer.from(`user:${userId}`));
    decipher.setAuthTag(Buffer.from(tag, "base64url"));
    return Buffer.concat([
      decipher.update(Buffer.from(ct, "base64url")),
      decipher.final(),
    ]).toString("utf8");
  } catch {
    return null;
  }
}

// ---------- checking a token ----------

export interface TokenCheck {
  /** unreachable = the collector's API did not answer; say nothing about the key. */
  state: CollectorStatus | "unreachable";
  creditLeftUsd: number | null;
  resetsAt: string | null;
}

async function get(token: string, path: string): Promise<Response | null> {
  try {
    return await fetch(`${apiBase()}${path}`, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    return null;
  }
}

/** Is this key valid, and how much of its monthly credit is left? */
export async function checkToken(token: string): Promise<TokenCheck> {
  const me = await get(token, "/users/me");
  if (!me) return { state: "unreachable", creditLeftUsd: null, resetsAt: null };
  if (me.status === 401 || me.status === 403) {
    return { state: "invalid", creditLeftUsd: null, resetsAt: null };
  }
  if (!me.ok) return { state: "unreachable", creditLeftUsd: null, resetsAt: null };

  const lim = await get(token, "/users/me/limits");
  if (!lim || !lim.ok) {
    // Valid key, but we could not read the balance. Assume usable.
    return { state: "ok", creditLeftUsd: null, resetsAt: null };
  }

  const body = (await lim.json().catch(() => null)) as {
    data?: {
      monthlyUsageCycle?: { endAt?: string };
      limits?: { maxMonthlyUsageUsd?: number };
      current?: { monthlyUsageUsd?: number };
    };
  } | null;

  const limit = body?.data?.limits?.maxMonthlyUsageUsd;
  const used = body?.data?.current?.monthlyUsageUsd;
  const resetsAt = body?.data?.monthlyUsageCycle?.endAt ?? null;

  if (typeof limit !== "number" || typeof used !== "number") {
    return { state: "ok", creditLeftUsd: null, resetsAt };
  }

  const left = Math.max(0, limit - used);
  return {
    state: left < MIN_CREDIT_USD ? "out_of_credit" : "ok",
    creditLeftUsd: Number(left.toFixed(4)),
    resetsAt,
  };
}

// ---------- persistence ----------

/** Records the outcome of a check. An "unreachable" result changes nothing. */
export async function saveCheck(userId: number, check: TokenCheck): Promise<void> {
  if (check.state === "unreachable") return;
  await query(
    `
    UPDATE users SET
      collector_status      = $2,
      collector_checked_at  = now(),
      collector_credit_left = $3,
      collector_resets_at   = COALESCE($4::timestamptz, collector_resets_at)
    WHERE id = $1 AND collector_key_enc IS NOT NULL
    `,
    [userId, check.state, check.creditLeftUsd, check.resetsAt]
  );
}

/** The user's decrypted token, or null if none / undecryptable. */
export async function getUserToken(userId: number): Promise<string | null> {
  const row = await queryOne<{ collector_key_enc: string | null }>(
    `SELECT collector_key_enc FROM users WHERE id = $1`,
    [userId]
  );
  return decryptToken(row?.collector_key_enc ?? null, userId);
}

export async function setStatus(
  userId: number,
  status: CollectorStatus
): Promise<void> {
  await query(
    `
    UPDATE users SET collector_status = $2, collector_checked_at = now()
    WHERE id = $1 AND collector_key_enc IS NOT NULL
    `,
    [userId, status]
  );
}

/** Safe-to-show view of a user's collector state. Never includes the token. */
export interface CollectorInfo {
  enabled: boolean;
  connected: boolean;
  last4: string | null;
  status: CollectorStatus | null;
  creditLeftUsd: number | null;
  resetsAt: string | null;
  checkedAt: string | null;
}

export async function getCollectorInfo(userId: number): Promise<CollectorInfo> {
  const row = await queryOne<{
    collector_key_enc: string | null;
    collector_key_last4: string | null;
    collector_status: string | null;
    collector_credit_left: string | null;
    collector_resets_at: string | null;
    collector_checked_at: string | null;
  }>(
    `
    SELECT collector_key_enc, collector_key_last4, collector_status,
           collector_credit_left, collector_resets_at, collector_checked_at
    FROM users WHERE id = $1
    `,
    [userId]
  );
  return {
    enabled: encryptionEnabled(),
    connected: !!row?.collector_key_enc,
    last4: row?.collector_key_last4 ?? null,
    status: (row?.collector_status as CollectorStatus | null) ?? null,
    creditLeftUsd:
      row?.collector_credit_left !== null && row?.collector_credit_left !== undefined
        ? Number(row.collector_credit_left)
        : null,
    resetsAt: row?.collector_resets_at ?? null,
    checkedAt: row?.collector_checked_at ?? null,
  };
}
