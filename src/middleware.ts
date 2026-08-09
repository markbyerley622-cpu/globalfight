import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

// ════════════════════════════════════════════════════════════════════════════
//  Middleware: the root redirect, and the ENFORCED Content-Security-Policy.
//
//  ── Why the CSP moved here from next.config ───────────────────────────────
//  It shipped as `Content-Security-Policy-Report-Only`, with a comment saying
//  the enforced version was blocked on nonces. Report-Only is a policy the
//  browser will tell you about and then obey nobody: it stopped nothing.
//
//  The blocker was real, though. Next injects its own inline bootstrap and
//  hydration scripts, so an enforced policy without `'unsafe-inline'` blocks the
//  framework itself and white-screens the app — and `'unsafe-inline'` in
//  script-src is the one directive whose absence actually buys XSS protection,
//  so keeping it would have been enforcement in name only.
//
//  A nonce is the documented answer, and it has to be generated per REQUEST,
//  which is why this cannot live in next.config's static headers. Next reads the
//  CSP off the REQUEST headers and stamps the same nonce onto every script tag
//  it emits — so the policy and the markup cannot disagree.
//
//  `'strict-dynamic'` lets the nonced bootstrap load the chunks it needs without
//  naming each one. `'self'` stays beside it purely as the fallback for browsers
//  that do not implement strict-dynamic; those get the old, weaker-but-working
//  behaviour rather than a blank page.
// ════════════════════════════════════════════════════════════════════════════

/** 128 bits, base64. Per request — a reused nonce is the same as no nonce. */
function makeNonce(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return btoa(String.fromCharCode(...bytes));
}

function policy(nonce: string): string {
  return [
    "default-src 'self'",
    "base-uri 'self'",
    "object-src 'none'",
    "frame-ancestors 'none'",
    "form-action 'self'",
    // The point of the whole exercise: no 'unsafe-inline' here.
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'`,
    // style-src KEEPS 'unsafe-inline', deliberately and permanently.
    //
    // React writes `style={{…}}` as a style ATTRIBUTE, and attributes cannot
    // carry a nonce — the only CSP mechanism that covers them is
    // 'unsafe-hashes', which would mean hashing every inline style in the
    // product and regenerating them on every design change. The threat it
    // would buy protection against is style injection, which is a defacement
    // and exfiltration-via-CSS risk, not script execution. Paying an
    // unmaintainable cost for the weaker half of the threat model is the wrong
    // trade; script-src is where the value is.
    "style-src 'self' 'unsafe-inline'",
    // flagcdn serves country flags via next/image `unoptimized` (a direct
    // browser request); cartocdn serves the map basemap tiles; the r2/blob
    // hosts are our own object storage.
    "img-src 'self' data: blob: https://*.r2.dev https://*.r2.cloudflarestorage.com https://*.public.blob.vercel-storage.com https://*.basemaps.cartocdn.com https://flagcdn.com",
    "font-src 'self' data:",
    "connect-src 'self'",
    "media-src 'self' https://*.r2.dev blob:",
    "worker-src 'self' blob:",
    "manifest-src 'self'",
    // ── `upgrade-insecure-requests` is DELIBERATELY ABSENT ──────────────────
    // It was here briefly, restored on the reasoning that browsers ignore it in
    // a Report-Only policy so an enforced policy should carry it. That was
    // wrong, and the original next.config comment had already said why: HSTS
    // (max-age 2y, includeSubDomains, preload) already forces HTTPS for this
    // whole domain, so on production the directive buys nothing.
    //
    // What it DOES do is break every non-HTTPS environment — local dev and the
    // E2E server. Reproduced in Chromium against a production build served on
    // http://127.0.0.1: `/fighters` fetched fine while `/` and
    // `/predictions/<slug>` failed with net::ERR_SSL_PROTOCOL_ERROR. The
    // difference is that those two are REDIRECTS: 127.0.0.1 is a trustworthy
    // origin so the initial request is exempt, but the Location header is an
    // absolute `http://…` URL and the upgrade applies to that. Next's client
    // router logged "Failed to fetch RSC payload … TypeError: Failed to fetch"
    // and fell back to full navigation, which is what turned the E2E suite red.
    //
    // Do not re-add it without HSTS being removed first.
  ].join("; ");
}

export function middleware(req: NextRequest) {
  // The events app is the home. A real 307 at the routing layer, so it fires
  // for hard loads, the installed PWA, typed URLs and shared links alike (a
  // page-level redirect() only soft-redirects RSC requests and left the URL
  // on "/"). Kept first: there is no point nonce-ing a response that is a
  // redirect with no body.
  if (req.nextUrl.pathname === "/") {
    const url = req.nextUrl.clone();
    url.pathname = "/events";
    return NextResponse.redirect(url);
  }

  const nonce = makeNonce();
  const csp = policy(nonce);

  // On the REQUEST, so Next itself can read it and stamp the nonce onto every
  // script tag it renders. This is the half that makes the policy survivable.
  const headers = new Headers(req.headers);
  headers.set("x-nonce", nonce);
  headers.set("Content-Security-Policy", csp);

  const res = NextResponse.next({ request: { headers } });
  // And on the RESPONSE, which is what the browser actually enforces.
  res.headers.set("Content-Security-Policy", csp);
  return res;
}

export const config = {
  // HTML responses only.
  //
  // `_next/static` and `_next/image` are hashed immutable assets — running
  // middleware on them would mint a nonce per asset request for no benefit and
  // defeat their caching. `api` routes return JSON, and the ones that return
  // something sensitive set their own stricter headers (see the identity
  // document reader, which sends its own sandboxed CSP and no-store).
  // Anything with a file extension is a public static file.
  matcher: ["/", "/((?!api|_next/static|_next/image|favicon.ico|.*\\.[\\w]+$).*)"],
};
