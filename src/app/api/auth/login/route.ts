import { NextResponse, type NextRequest } from "next/server";
import { query, queryOne } from "@/lib/db";
import {
  SESSION_COOKIE,
  SESSION_MAX_AGE,
  createSessionValue,
} from "@/lib/auth";
import { DUMMY_HASH, normalizeEmail, verifyPassword } from "@/lib/password";

export const dynamic = "force-dynamic";

const MAX_FAILURES = 5;
const LOCK_MINUTES = 15;

const BAD_LOGIN = "That email and password don't match.";

export async function POST(req: NextRequest) {
  let payload: { email?: unknown; password?: unknown };
  try {
    payload = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }

  const email = normalizeEmail(payload.email);
  const password = typeof payload.password === "string" ? payload.password : "";
  if (!email || !password || password.length > 200) {
    return NextResponse.json({ error: BAD_LOGIN }, { status: 401 });
  }

  const user = await queryOne<{
    id: string;
    password_hash: string;
    locked_until: string | null;
  }>(`SELECT id, password_hash, locked_until FROM users WHERE email = $1`, [
    email,
  ]);

  if (user?.locked_until && new Date(user.locked_until) > new Date()) {
    return NextResponse.json(
      { error: "Too many attempts. Try again in a few minutes." },
      { status: 429 }
    );
  }

  // Always run a hash, even for an unknown email, so timing does not reveal
  // which emails have accounts.
  const ok = await verifyPassword(password, user?.password_hash ?? DUMMY_HASH);

  if (!user || !ok) {
    if (user) {
      await query(
        `
        UPDATE users SET
          failed_logins = CASE WHEN failed_logins + 1 >= $2 THEN 0
                               ELSE failed_logins + 1 END,
          locked_until  = CASE WHEN failed_logins + 1 >= $2
                               THEN now() + ($3 || ' minutes')::interval
                               ELSE locked_until END
        WHERE id = $1
        `,
        [user.id, MAX_FAILURES, String(LOCK_MINUTES)]
      );
    }
    return NextResponse.json({ error: BAD_LOGIN }, { status: 401 });
  }

  await query(
    `UPDATE users SET failed_logins = 0, locked_until = NULL, last_login_at = now() WHERE id = $1`,
    [user.id]
  );

  const res = NextResponse.json({ ok: true });
  res.cookies.set(SESSION_COOKIE, await createSessionValue(Number(user.id)), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: SESSION_MAX_AGE,
  });
  return res;
}
