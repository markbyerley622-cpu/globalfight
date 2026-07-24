import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

// The events app is the home. Redirect the bare root to /events at the routing
// layer — a real 307 that fires for hard loads, the installed PWA, typed URLs
// and shared links alike (a page-level redirect() only soft-redirects RSC
// requests and left the URL on "/"). A sport filter on the URL is carried over.
export function middleware(req: NextRequest) {
  const url = req.nextUrl.clone();
  url.pathname = "/events";
  return NextResponse.redirect(url);
}

// Only the bare root — nothing else is touched.
export const config = { matcher: "/" };
