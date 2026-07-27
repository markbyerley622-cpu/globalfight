import { NextResponse } from "next/server";
import { isEmbeddable, safeArticleUrl } from "@/lib/embeddability";
import { hit, clientIp, POLICY } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * "Can I frame this?" — asked by the article reader before it renders an iframe.
 *
 * The check itself makes an outbound request, so this endpoint is rate limited:
 * without it, anyone could use it as an open request-relay to probe arbitrary
 * hosts and read back a coarse signal about them. `safeArticleUrl` already blocks
 * private and loopback addresses; the limit bounds volume on top of that.
 *
 * Cacheable at the edge for an hour. The underlying answer is cached per hostname
 * for a day, so this header only affects repeat asks for the same article within
 * a session — but it makes a burst of taps on one story free.
 */
export async function GET(req: Request) {
  const gate = await hit(`embed-check:${clientIp(req)}`, POLICY.interaction.limit, POLICY.interaction.windowMs);
  if (!gate.ok) {
    return NextResponse.json(
      { embeddable: false, reason: "rate limited" },
      { status: 429, headers: { "retry-after": String(gate.retryAfter) } },
    );
  }

  const raw = new URL(req.url).searchParams.get("url") ?? "";
  const url = safeArticleUrl(raw);
  if (!url) {
    // Not an error the reader should surface — it just means "show the fallback".
    return NextResponse.json({ embeddable: false, reason: "unsupported url" });
  }

  const result = await isEmbeddable(url.toString());
  return NextResponse.json(result, {
    headers: { "cache-control": "public, max-age=3600, stale-while-revalidate=86400" },
  });
}
