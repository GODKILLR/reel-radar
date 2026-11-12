import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE, isValidSession } from "@/lib/auth";

/**
 * Sends signed-out visitors to /login. This only checks that the session
 * cookie is genuine and unexpired (the edge cannot reach Postgres); every API
 * route then loads the real user and enforces plan limits itself.
 *
 * Exempt paths are either public pages or carry their own secret and are called
 * by machines that cannot hold a session cookie:
 *   /api/cron           - the scheduler, authed by CRON_SECRET
 *   /api/hooks/         - the collector's callback, authed by a single-use
 *                         per-run token (not a global secret)
 *   /api/admin/migrate  - one-shot setup, authed by CRON_SECRET
 */
const EXEMPT_PREFIXES = [
  "/api/cron",
  "/api/hooks/",
  "/api/admin/migrate",
  "/login",
  "/signup",
  "/api/auth/",
];

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  if (EXEMPT_PREFIXES.some((p) => pathname.startsWith(p))) {
    return NextResponse.next();
  }

  const session = req.cookies.get(SESSION_COOKIE)?.value;
  if (await isValidSession(session)) return NextResponse.next();

  // API calls get a 401 rather than an HTML redirect, so fetch() in the
  // dashboard fails loudly instead of parsing a login page as JSON.
  if (pathname.startsWith("/api/")) {
    return NextResponse.json({ error: "Please sign in." }, { status: 401 });
  }

  const login = req.nextUrl.clone();
  login.pathname = "/login";
  login.search = pathname === "/" ? "" : `?next=${encodeURIComponent(pathname)}`;
  return NextResponse.redirect(login);
}

export const config = {
  // Everything except Next's own assets and the favicon.
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
