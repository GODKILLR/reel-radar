/**
 * Makes an existing user an admin, and optionally hands them everything that
 * was collected before accounts existed.
 *
 *   npm run make-admin -- you@example.com
 *   npm run make-admin -- you@example.com --claim-legacy
 *
 * --claim-legacy links every already-tracked account to this user (so the data
 * collected in the single-user days shows up in their feed) and copies the old
 * global saved-ideas list to them. Both are no-ops when run again.
 */
import { query, queryOne } from "../src/lib/db";
import { normalizeEmail } from "../src/lib/password";

(async () => {
  const args = process.argv.slice(2);
  const email = normalizeEmail(args.find((a) => !a.startsWith("--")));
  const claim = args.includes("--claim-legacy");

  if (!email) {
    console.error("Usage: npm run make-admin -- <email> [--claim-legacy]");
    process.exit(1);
  }

  const user = await queryOne<{ id: string }>(
    `UPDATE users SET is_admin = TRUE WHERE email = $1 RETURNING id`,
    [email]
  );
  if (!user) {
    console.error(`No user with email ${email}. Sign up in the app first.`);
    process.exit(1);
  }
  console.log(`${email} is now an admin.`);

  if (claim) {
    const linked = await query(
      `
      INSERT INTO user_competitors (user_id, competitor_id)
      SELECT $1, id FROM competitors
      ON CONFLICT DO NOTHING
      RETURNING competitor_id
      `,
      [user.id]
    );
    const saved = await query(
      `
      INSERT INTO user_watchlist (user_id, shortcode, status, note, added_at)
      SELECT $1, shortcode, status, note, added_at FROM watchlist
      ON CONFLICT DO NOTHING
      RETURNING shortcode
      `,
      [user.id]
    );
    console.log(
      `Claimed ${linked.length} account(s) and ${saved.length} saved idea(s).`
    );
  }
  process.exit(0);
})();
