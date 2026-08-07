import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { SESSION_COOKIE } from "@/lib/auth-cookie";

/**
 * `/` routes two ways, and this is the layer that has to make the call.
 *
 *   • a member (session cookie present) → /events, exactly as before
 *   • everyone else                     → through, to the public landing page
 *
 * ── Why the redirect lives here and not only in the page ────────────────────
 * A page-level `redirect()` only SOFT-redirects an RSC request: the app renders
 * /events while the address bar stays on "/", which breaks Back and makes a
 * share of that tab point at the wrong document. A real 307 from the routing
 * layer fires identically for a hard load, the installed PWA (which opens the
 * bare origin), a typed URL and a shared link. `page.tsx` keeps its own
 * `redirect()` behind this one — that is the check which verifies the session
 * properly, and it is what catches a client-side navigation to "/".
 *
 * ── Why cookie PRESENCE, not a verified session ─────────────────────────────
 * Middleware runs on the edge runtime, and a real verification needs the
 * `tokenVersion` lookup in Postgres — `getCurrentUser()` cannot run here. That
 * is acceptable because this is a routing hint, not an authorization decision:
 * nothing is granted by being sent to /events, which is a public page anyone can
 * read. The worst case is a visitor holding a stale cookie landing on the events
 * app signed out rather than on the landing page, and /events serves anonymous
 * readers perfectly well. No security boundary is drawn here; every one of them
 * is still drawn by `getCurrentUser()` on the server.
 *
 * A sport filter on the URL is carried over by `nextUrl.clone()`, which keeps
 * the query string — so an existing `/?sport=boxing` link still lands a member
 * on the filtered app.
 */
export function middleware(req: NextRequest) {
  if (!req.cookies.has(SESSION_COOKIE)) return NextResponse.next();

  const url = req.nextUrl.clone();
  url.pathname = "/events";
  return NextResponse.redirect(url);
}

// Only the bare root — nothing else is touched.
export const config = { matcher: "/" };
