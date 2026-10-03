import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE, isAuthEnabled, isValidSession } from "@/lib/auth";

/**
 * Gates the dashboard behind the shared password.
 *
 * Exempt paths carry their own secret and are called by machines that cannot
 * hold a session cookie:
 *   /api/cron            - the scheduler, authed by CRON_SECRET
 *   /api/webhooks/apify  - Apify's callback, authed by WEBHOOK_SECRET
 *   /api/admin/migrate   - one-shot setup, authed by CRON_SECRET
 */
const EXEMPT_PREFIXES = [
  "/api/cron",
  "/api/webhooks/",
  "/api/admin/",
  "/login",
  "/api/auth",
];

export async function middleware(req: NextRequest) {
  // No password set means local development; leave everything open.
  if (!isAuthEnabled()) return NextResponse.next();

  const { pathname } = req.nextUrl;
  if (EXEMPT_PREFIXES.some((p) => pathname.startsWith(p))) {
    return NextResponse.next();
  }

  const session = req.cookies.get(SESSION_COOKIE)?.value;
  if (await isValidSession(session)) return NextResponse.next();

  // API calls get a 401 rather than an HTML redirect, so fetch() in the
  // dashboard fails loudly instead of parsing a login page as JSON.
  if (pathname.startsWith("/api/")) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
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
