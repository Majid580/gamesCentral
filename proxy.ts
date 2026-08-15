import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

/**
 * Optimistic auth gate for the admin area.
 *
 * Next.js 16 renamed Middleware to Proxy (see
 * node_modules/next/dist/docs/01-app/01-getting-started/16-proxy.md). Those
 * docs are explicit that this layer is **not** an authorisation solution — it
 * runs before the request completes and should only do cheap optimistic
 * checks. So this file exists to redirect signed-out visitors to the login
 * page, and nothing more.
 *
 * The actual authorisation happens in `requireAdmin()`, which every admin page
 * and every admin action calls. That is deliberate defence in depth: a
 * matcher typo here would expose a page, whereas a missing `requireAdmin()`
 * call fails closed because the data functions themselves refuse to run.
 *
 * The cookie is only checked for PRESENCE here — it is not verified. A forged
 * cookie gets past this line and is then rejected by `requireAdmin()`.
 */

const SESSION_COOKIES = [
  "authjs.session-token",
  "__Secure-authjs.session-token",
];

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // The login page itself must stay reachable while signed out.
  if (pathname === "/admin/login") return NextResponse.next();

  const hasSession = SESSION_COOKIES.some((name) => request.cookies.has(name));
  if (hasSession) return NextResponse.next();

  const login = new URL("/admin/login", request.url);
  // Send them back where they were headed once they are in.
  login.searchParams.set("from", pathname);
  return NextResponse.redirect(login);
}

export const config = {
  matcher: ["/admin/:path*"],
};
