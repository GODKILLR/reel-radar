import { NextResponse, type NextRequest } from "next/server";
import { query, transaction } from "@/lib/db";
import { config } from "@/lib/config";
import { parseUsername } from "@/lib/username";
import { authed, limitsFor, usesOwnCollector } from "@/lib/session";
import { ADD_ACCOUNT_COST, isUnlimited } from "@/lib/plans";

export const dynamic = "force-dynamic";

/** The accounts this user tracks. */
export async function GET() {
  const a = await authed();
  if ("res" in a) return a.res;

  const rows = await query(
    `
    SELECT
      c.id, c.username, c.display_name, c.profile_pic_url, c.followers,
      c.backfilled_at, c.last_scraped_at, c.median_views, c.post_count,
      (SELECT COUNT(*) FROM posts p
        WHERE p.competitor_id = c.id AND p.posted_at > now() - interval '7 days'
      ) AS posts_last_7d,
      (SELECT COUNT(*) FROM posts p
        WHERE p.competitor_id = c.id AND p.outlier_score >= $2
          AND p.posted_at > now() - interval '30 days'
      ) AS outliers_last_30d
    FROM user_competitors uc
    JOIN competitors c ON c.id = uc.competitor_id
    WHERE uc.user_id = $1
    ORDER BY c.username
    `,
    [a.user.id, config.outlier.threshold]
  );
  return NextResponse.json({ competitors: rows });
}

class PlanError extends Error {
  status: number;
  code: string;
  constructor(message: string, status: number, code: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

/**
 * Track a new account. Everything that must hold together happens in one
 * transaction with the user's row locked: the plan limit, the points balance,
 * the link and the ledger entry. Two rapid clicks therefore cannot overspend.
 */
export async function POST(req: NextRequest) {
  const a = await authed();
  if ("res" in a) return a.res;
  const { user } = a;
  const limits = limitsFor(user);

  let payload: { username?: string };
  try {
    payload = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }

  const username = parseUsername(payload.username ?? "");
  if (!username) {
    return NextResponse.json(
      { error: "Enter a valid Instagram handle or profile URL." },
      { status: 400 }
    );
  }

  try {
    const result = await transaction(async (tx) => {
      const [locked] = await tx.query<{ points: number }>(
        `SELECT points FROM users WHERE id = $1 FOR UPDATE`,
        [user.id]
      );
      if (!locked) throw new PlanError("Please sign in.", 401, "auth");

      const [{ n }] = await tx.query<{ n: string }>(
        `SELECT COUNT(*)::text AS n FROM user_competitors WHERE user_id = $1`,
        [user.id]
      );
      if (Number(n) >= limits.maxAccounts) {
        throw new PlanError(
          `Your ${limits.name} plan tracks up to ${limits.maxAccounts} accounts. Remove one to add another${user.isAdmin ? "." : ", or upgrade for more."}`,
          403,
          "account_limit"
        );
      }

      // Admins and users collecting on their own key are not charged points:
      // points exist to cover OUR collection cost.
      const cost =
        user.isAdmin || usesOwnCollector(user) ? 0 : ADD_ACCOUNT_COST;
      if (locked.points < cost) {
        throw new PlanError(
          `You need ${cost} points to add an account and have ${locked.points}. Points refill on your next monthly reset.`,
          402,
          "no_points"
        );
      }

      // The account row is shared. If someone already tracks this handle we
      // simply link to it - it is already being collected.
      const [comp] = await tx.query<{ id: number }>(
        `
        INSERT INTO competitors (username) VALUES ($1)
        ON CONFLICT (username) DO UPDATE SET username = EXCLUDED.username
        RETURNING id
        `,
        [username]
      );

      const linked = await tx.query(
        `
        INSERT INTO user_competitors (user_id, competitor_id)
        VALUES ($1, $2) ON CONFLICT DO NOTHING
        RETURNING competitor_id
        `,
        [user.id, comp.id]
      );
      if (linked.length === 0) {
        throw new PlanError(`You're already tracking @${username}.`, 409, "dup");
      }

      let balance = locked.points;
      if (cost > 0) {
        balance = locked.points - cost;
        await tx.query(`UPDATE users SET points = $2 WHERE id = $1`, [
          user.id,
          balance,
        ]);
        await tx.query(
          `
          INSERT INTO points_ledger (user_id, delta, balance_after, reason)
          VALUES ($1, $2, $3, $4)
          `,
          [user.id, -cost, balance, `Added @${username}`]
        );
      }

      return { id: comp.id, balance, cost };
    });

    // backfilled_at stays null until the first collection, so the next poll
    // cycle picks a brand-new account up for its one-time history fetch.
    return NextResponse.json(
      {
        competitor: { id: result.id, username },
        pointsSpent: result.cost,
        points: result.balance,
        unlimited: isUnlimited(limits.maxAccounts),
      },
      { status: 201 }
    );
  } catch (err) {
    if (err instanceof PlanError) {
      return NextResponse.json(
        { error: err.message, code: err.code },
        { status: err.status }
      );
    }
    throw err;
  }
}
