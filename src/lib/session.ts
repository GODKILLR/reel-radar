/**
 * Loading the signed-in user inside route handlers and server components.
 * Node runtime only (it queries Postgres).
 */
import { cookies } from "next/headers";
import { after, NextResponse } from "next/server";
import { SESSION_COOKIE, readSession } from "./auth";
import { query, queryOne } from "./db";
import {
  DISCOVER_LIMIT,
  REELS_PER_ACCOUNT,
  REFRESH_HOURS,
  planOf,
  type Plan,
  type PlanId,
} from "./plans";

interface UserRow {
  id: string;
  email: string;
  name: string | null;
  plan: string;
  is_admin: boolean;
  has_key: boolean;
  collector_status: string | null;
  stale_seen: boolean;
}

export interface User {
  id: number;
  email: string;
  name: string | null;
  plan: PlanId;
  planInfo: Plan;
  isAdmin: boolean;
  /** Has connected their own collector key. */
  hasOwnKey: boolean;
  collectorStatus: string | null;
}

const COLUMNS = `id, email, name, plan, is_admin,
  (collector_key_enc IS NOT NULL) AS has_key, collector_status,
  (last_seen_at < now() - interval '1 day') AS stale_seen`;

function toUser(row: UserRow): User {
  const planInfo = planOf(row.plan);
  return {
    id: Number(row.id),
    email: row.email,
    name: row.name,
    plan: planInfo.id,
    planInfo,
    isAdmin: row.is_admin,
    hasOwnKey: row.has_key,
    collectorStatus: row.collector_status,
  };
}

export async function getUser(): Promise<User | null> {
  const jar = await cookies();
  const uid = await readSession(jar.get(SESSION_COOKIE)?.value);
  if (!uid) return null;

  const row = await queryOne<UserRow>(
    `SELECT ${COLUMNS} FROM users WHERE id = $1`,
    [uid]
  );
  if (row?.stale_seen) {
    // "Last seen" is touched at most once a day, so it costs one tiny write a
    // day per user. It only decides when long-gone users' tracking is cleaned up.
    const touch = () =>
      query(`UPDATE users SET last_seen_at = now() WHERE id = $1`, [uid]).catch(
        () => undefined
      );
    try {
      after(touch);
    } catch {
      await touch();
    }
  }
  return row ? toUser(row) : null;
}

/**
 * Whether this user can have accounts collected. Everyone collects on their OWN
 * key, so a user needs one that works. (An out-of-credit key still counts: it
 * resumes by itself when the credit renews.) Admins are collected by us.
 */
export function canCollect(user: User): boolean {
  if (user.isAdmin) return true;
  return user.hasOwnKey && user.collectorStatus !== "invalid";
}

/** What a user's plan allows. Admins get the admin plan. */
export interface Limits {
  name: string;
  maxAccounts: number;
  reelsPerAccount: number;
  refreshHours: number;
  discoverLimit: number;
}

export function limitsFor(user: User): Limits {
  const plan = user.isAdmin ? planOf("admin") : user.planInfo;
  return {
    name: plan.name,
    maxAccounts: plan.maxAccounts,
    reelsPerAccount: REELS_PER_ACCOUNT,
    refreshHours: REFRESH_HOURS,
    discoverLimit: DISCOVER_LIMIT,
  };
}

type Authed = { user: User } | { res: NextResponse };

/** For route handlers: `const a = await authed(); if ("res" in a) return a.res;` */
export async function authed(): Promise<Authed> {
  const user = await getUser();
  if (!user) {
    return {
      res: NextResponse.json({ error: "Please sign in." }, { status: 401 }),
    };
  }
  return { user };
}

export async function adminOnly(): Promise<Authed> {
  const a = await authed();
  if ("res" in a) return a;
  if (!a.user.isAdmin) {
    // 404 rather than 403: do not confirm admin routes exist to other users.
    return { res: NextResponse.json({ error: "Not found." }, { status: 404 }) };
  }
  return a;
}

/** Public shape sent to the browser. */
export function publicUser(user: User) {
  const limits = limitsFor(user);
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    plan: user.plan,
    planName: limits.name,
    isAdmin: user.isAdmin,
    canCollect: canCollect(user),
    hasKey: user.hasOwnKey,
    collectorStatus: user.collectorStatus,
    limits: {
      maxAccounts: limits.maxAccounts,
      reelsPerAccount: limits.reelsPerAccount,
      refreshHours: limits.refreshHours,
      discoverLimit: limits.discoverLimit,
    },
  };
}
