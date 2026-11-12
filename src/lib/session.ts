/**
 * Loading the signed-in user inside route handlers and server components.
 * Node runtime only (it queries Postgres).
 */
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { SESSION_COOKIE, readSession } from "./auth";
import { query, queryOne } from "./db";
import { planOf, type Plan, type PlanId } from "./plans";

interface UserRow {
  id: string;
  email: string;
  name: string | null;
  plan: string;
  points: number;
  points_reset_at: string;
  is_admin: boolean;
  has_key: boolean;
  collector_status: string | null;
}

export interface User {
  id: number;
  email: string;
  name: string | null;
  plan: PlanId;
  planInfo: Plan;
  points: number;
  pointsResetAt: string;
  isAdmin: boolean;
  /** Has connected their own collector key. */
  hasOwnKey: boolean;
  collectorStatus: string | null;
}

const COLUMNS = `id, email, name, plan, points, points_reset_at, is_admin,
  (collector_key_enc IS NOT NULL) AS has_key, collector_status`;

function toUser(row: UserRow): User {
  const planInfo = planOf(row.plan);
  return {
    id: Number(row.id),
    email: row.email,
    name: row.name,
    plan: planInfo.id,
    planInfo,
    points: row.points,
    pointsResetAt: row.points_reset_at,
    // An admin account always gets the admin plan limits.
    isAdmin: row.is_admin,
    hasOwnKey: row.has_key,
    collectorStatus: row.collector_status,
  };
}

/**
 * Monthly refill, done lazily: the first time a user is loaded after their
 * reset date the balance resets to the plan's allowance. No scheduler needed.
 * The row lock makes two simultaneous requests refill only once.
 */
async function refillIfDue(row: UserRow): Promise<UserRow> {
  if (new Date(row.points_reset_at).getTime() > Date.now()) return row;

  const plan = planOf(row.is_admin ? "admin" : row.plan);
  if (plan.monthlyPoints === 0 && row.is_admin) {
    // Admins are not metered; just push the date forward.
    await query(
      `UPDATE users SET points_reset_at = now() + interval '1 month' WHERE id = $1`,
      [row.id]
    );
  } else {
    await query(
      `
      WITH old AS (
        SELECT id, points FROM users
        WHERE id = $1 AND points_reset_at <= now()
        FOR UPDATE
      ),
      upd AS (
        UPDATE users u
        SET points = $2, points_reset_at = now() + interval '1 month'
        FROM old WHERE u.id = old.id
        RETURNING u.id, u.points, old.points AS old_points
      )
      INSERT INTO points_ledger (user_id, delta, balance_after, reason)
      SELECT id, points - old_points, points, 'Monthly refill' FROM upd
      `,
      [row.id, plan.monthlyPoints]
    );
  }

  const fresh = await queryOne<UserRow>(
    `SELECT ${COLUMNS} FROM users WHERE id = $1`,
    [row.id]
  );
  return fresh ?? row;
}

export async function getUser(): Promise<User | null> {
  const jar = await cookies();
  const uid = await readSession(jar.get(SESSION_COOKIE)?.value);
  if (!uid) return null;

  const row = await queryOne<UserRow>(
    `SELECT ${COLUMNS} FROM users WHERE id = $1`,
    [uid]
  );
  if (!row) return null;

  return toUser(await refillIfDue(row));
}

/**
 * True when a Free user's collection runs on their OWN collector key. Such a
 * user pays for their own scraping, so they get higher account limits and are
 * not charged points to add accounts. A key that has stopped working
 * ("invalid") does not count: they fall back to the Free limits.
 */
export function usesOwnCollector(user: User): boolean {
  return (
    !user.isAdmin &&
    user.plan === "free" &&
    user.hasOwnKey &&
    user.collectorStatus !== "invalid"
  );
}

/** Where a user's plan limits come from: admins get the admin plan. */
export function limitsFor(user: User): Plan {
  if (user.isAdmin) return planOf("admin");
  if (usesOwnCollector(user)) return planOf("connect");
  return user.planInfo;
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
    planName: user.isAdmin
      ? "Admin"
      : usesOwnCollector(user)
        ? "Free + own key"
        : user.planInfo.name,
    ownKey: usesOwnCollector(user),
    points: user.points,
    pointsResetAt: user.pointsResetAt,
    isAdmin: user.isAdmin,
    limits: {
      maxAccounts: limits.maxAccounts,
      reelsPerAccount: limits.reelsPerAccount,
      refreshHours: limits.refreshHours,
      savedLimit: limits.savedLimit,
      discoverLimit: limits.discoverLimit,
      monthlyPoints: limits.monthlyPoints,
    },
  };
}
