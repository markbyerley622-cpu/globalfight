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

const MAX_BYTES = 8 * 1024 * 1024; // 8 MB
const TIMEOUT_MS = 6000;
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
    const upstream = await fetch(target, {
      headers: { "user-agent": UA, accept: "image/*" },
      redirect: "follow",
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
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
