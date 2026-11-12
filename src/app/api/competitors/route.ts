import { NextResponse, type NextRequest } from "next/server";
import { query, transaction } from "@/lib/db";
import { config } from "@/lib/config";
import { parseUsername } from "@/lib/username";
import { authed, canCollect, limitsFor } from "@/lib/session";

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
 * Track a new account. Collection runs on the user's OWN key, so they need one
 * connected first. The plan limit is checked in a transaction with the user's
 * row locked, so two rapid clicks cannot slip past it.
 */
export async function POST(req: NextRequest) {
  const a = await authed();
  if ("res" in a) return a.res;
  const { user } = a;
  const limits = limitsFor(user);

  if (!canCollect(user)) {
    return NextResponse.json(
      {
        error:
          user.hasOwnKey
            ? "Your Apify key stopped working. Reconnect it to keep tracking accounts."
            : "Connect your Apify key first. It takes about a minute, and it's what collects the reels for you.",
        code: "needs_key",
      },
      { status: 403 }
    );
  }

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
      const [locked] = await tx.query(
        `SELECT 1 FROM users WHERE id = $1 FOR UPDATE`,
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
      return { id: comp.id };
    });

    // backfilled_at stays null until the first collection, so the next poll
    // cycle picks a brand-new account up for its one-time history fetch.
    return NextResponse.json(
      { competitor: { id: result.id, username } },
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
