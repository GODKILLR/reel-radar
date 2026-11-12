import { NextResponse, type NextRequest } from "next/server";
import { queryOne } from "@/lib/db";
import {
  SESSION_COOKIE,
  SESSION_MAX_AGE,
  createSessionValue,
} from "@/lib/auth";
import {
  hashPassword,
  normalizeEmail,
  passwordProblem,
} from "@/lib/password";

export const dynamic = "force-dynamic";

/** Comma-separated emails that become admins when they sign up. */
function isAdminEmail(email: string): boolean {
  return (process.env.ADMIN_EMAILS ?? "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean)
    .includes(email);
}

export async function POST(req: NextRequest) {
  let payload: { email?: unknown; password?: unknown; name?: unknown };
  try {
    payload = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }

  const email = normalizeEmail(payload.email);
  if (!email) {
    return NextResponse.json(
      { error: "Enter a valid email address." },
      { status: 400 }
    );
  }
  const problem = passwordProblem(payload.password);
  if (problem) {
    return NextResponse.json({ error: problem }, { status: 400 });
  }

  const name =
    typeof payload.name === "string" && payload.name.trim()
      ? payload.name.trim().slice(0, 80)
      : null;

  const existing = await queryOne(`SELECT 1 FROM users WHERE email = $1`, [
    email,
  ]);
  if (existing) {
    return NextResponse.json(
      { error: "An account with that email already exists. Try logging in." },
      { status: 409 }
    );
  }

  const passwordHash = await hashPassword(payload.password as string);
  const admin = isAdminEmail(email);

  let userId: number;
  try {
    const row = await queryOne<{ id: string }>(
      `
      INSERT INTO users (email, password_hash, name, plan, is_admin)
      VALUES ($1, $2, $3, $4, $5)
      RETURNING id
      `,
      [email, passwordHash, name, admin ? "ultra" : "free", admin]
    );
    userId = Number(row!.id);
  } catch (err) {
    // Two sign-ups racing on the same email: the unique index decides.
    if ((err as { code?: string }).code === "23505") {
      return NextResponse.json(
        { error: "An account with that email already exists. Try logging in." },
        { status: 409 }
      );
    }
    throw err;
  }

  const res = NextResponse.json({ ok: true }, { status: 201 });
  res.cookies.set(SESSION_COOKIE, await createSessionValue(userId), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: SESSION_MAX_AGE,
  });
  return res;
}
