import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// ════════════════════════════════════════════════════════════════════════
//  Article-image proxy.
//
//  Fetches a publisher's syndication image (from an RSS media:* / enclosure
//  element) and streams it back, cached at the edge. We proxy rather than
//  hotlink so we don't leech the publisher's bandwidth and don't have to add
//  372 publisher hosts to next/image's remotePatterns. Every image is shown
//  ATTRIBUTED and LINKED to the source article (see the article cards).
//
//  Hardened against SSRF: https only, public hosts only (no localhost / private
//  ranges / raw IPs), image content-types only, with size + time caps.
// ════════════════════════════════════════════════════════════════════════

import { lookup } from "node:dns/promises";
import net from "node:net";

const MAX_BYTES = 8 * 1024 * 1024; // 8 MB
const TIMEOUT_MS = 6000;
const MAX_REDIRECTS = 3;
const UA = "CombatRegisterBot/2.0 (+https://combat-register.vercel.app/bot)";

// Blocks localhost, private/link-local/loopback ranges, and bare IP literals.
function isBlockedHost(host: string): boolean {
  const h = host.toLowerCase();
  if (h === "localhost" || h.endsWith(".localhost") || h.endsWith(".local") || h.endsWith(".internal")) return true;
  // Any numeric IP literal — refuse; publishers use hostnames, IPs are an SSRF tell.
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(h)) return true;
  if (h.includes(":")) return true; // IPv6 literal
  return false;
}

// Is a RESOLVED address one we must never connect to? The hostname check above
// only sees the string, so `127.0.0.1.nip.io` (a public-looking name that
// resolves to 127.0.0.1) sails past it. Without this, /api/img is an
// unauthenticated SSRF: an attacker points `u` at a name resolving to a private
// address and uses the proxy to scan the internal network or reach an internal
// service. So we resolve every host and reject the address itself.
function isBlockedAddress(ip: string): boolean {
  if (net.isIPv4(ip)) {
    const p = ip.split(".").map(Number);
    if (p[0] === 10) return true; // 10.0.0.0/8
    if (p[0] === 127) return true; // loopback
    if (p[0] === 0) return true; // 0.0.0.0/8 "this host"
    if (p[0] === 172 && p[1] >= 16 && p[1] <= 31) return true; // 172.16.0.0/12
    if (p[0] === 192 && p[1] === 168) return true; // 192.168.0.0/16
    if (p[0] === 169 && p[1] === 254) return true; // link-local incl. cloud metadata 169.254.169.254
    if (p[0] === 100 && p[1] >= 64 && p[1] <= 127) return true; // 100.64.0.0/10 CGNAT
    if (p[0] >= 224) return true; // multicast / reserved
    return false;
  }
  const v = ip.toLowerCase();
  if (v === "::1" || v === "::") return true; // loopback / unspecified
  if (v.startsWith("fe80")) return true; // link-local
  if (v.startsWith("fc") || v.startsWith("fd")) return true; // unique-local fc00::/7
  // IPv4-mapped (::ffff:a.b.c.d) — re-check the embedded v4.
  const m = v.match(/(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/);
  if (m && net.isIPv4(m[1])) return isBlockedAddress(m[1]);
  return false;
}

// Resolve a hostname and refuse if ANY returned address is private/loopback.
// Checking every answer (not just the first) closes the DNS-rebinding trick of
// returning a public A record alongside a private one.
async function assertPublicHost(host: string): Promise<void> {
  let addrs: { address: string }[];
  try {
    addrs = await lookup(host, { all: true });
  } catch {
    throw new Error("dns resolution failed");
  }
  if (addrs.length === 0 || addrs.some((a) => isBlockedAddress(a.address))) {
    throw new Error("forbidden address");
  }
}

// Follow redirects MANUALLY, re-running the https + host guard on every hop.
// `redirect: "follow"` would let a permitted host 302 us to http://169.254.169.254
// or an internal name — the guard only ran on the initial URL. One shared
// deadline bounds total time across hops.
async function safeFetch(start: URL): Promise<Response> {
  const signal = AbortSignal.timeout(TIMEOUT_MS);
  let current = start;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    // Resolve-and-check immediately before the fetch, on every hop. (There is a
    // theoretical TOCTOU gap between this lookup and fetch's own resolution;
    // closing it fully needs a pinned-IP dispatcher. The check still removes the
    // whole class of "hostname that resolves private" and every redirect-based
    // bypass, which is what was exploitable.)
    await assertPublicHost(current.hostname);
    const res = await fetch(current, {
      headers: { "user-agent": UA, accept: "image/*" },
      redirect: "manual",
      signal,
    });
    if (res.status < 300 || res.status >= 400) return res; // not a redirect
    const loc = res.headers.get("location");
    if (!loc) return res;
    let next: URL;
    try {
      next = new URL(loc, current);
    } catch {
      throw new Error("bad redirect target");
    }
    if (next.protocol !== "https:" || isBlockedHost(next.hostname)) {
      throw new Error("forbidden redirect target");
    }
    current = next;
  }
  throw new Error("too many redirects");
}

export async function GET(req: Request) {
  const raw = new URL(req.url).searchParams.get("u");
  if (!raw) return NextResponse.json({ error: "missing url" }, { status: 400 });

  let target: URL;
  try {
    target = new URL(raw);
  } catch {
    return NextResponse.json({ error: "bad url" }, { status: 400 });
  }
  if (target.protocol !== "https:" || isBlockedHost(target.hostname)) {
    return NextResponse.json({ error: "forbidden host" }, { status: 400 });
  }

  try {
    const upstream = await safeFetch(target);
    const type = upstream.headers.get("content-type") ?? "";
    if (!upstream.ok || !type.startsWith("image/")) {
      return NextResponse.json({ error: "not an image" }, { status: 404 });
    }
    const buf = await upstream.arrayBuffer();
    if (buf.byteLength > MAX_BYTES) {
      return NextResponse.json({ error: "too large" }, { status: 413 });
    }
    return new NextResponse(buf, {
      status: 200,
      headers: {
        "content-type": type,
        // Cache hard: syndication thumbnails are immutable once published.
        "cache-control": "public, max-age=86400, s-maxage=604800, immutable",
      },
    });
  } catch {
    return NextResponse.json({ error: "fetch failed" }, { status: 502 });
  }
}
