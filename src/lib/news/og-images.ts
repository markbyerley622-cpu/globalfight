import "server-only";
import { prisma } from "@/lib/db";

// ════════════════════════════════════════════════════════════════════════
//  Article image enrichment.
//
//  Most news arrives from Google News RSS, which carries NO syndication image,
//  so ~94% of articles had only a generated placeholder. This fetches the
//  article's own OpenGraph / Twitter-card image (the picture the publisher chose
//  to represent the piece) and stores it in ogImageUrl. The card layer already
//  falls back coverImageUrl → ogImageUrl → generated, so a populated ogImageUrl
//  turns a placeholder into the real image.
//
//  Only the article's declared social image is read (a public meta tag intended
//  for exactly this) — no full-page scrape, no media re-hosting here; display
//  still runs through the attributed /api/img proxy. Newest first, since that's
//  what users see. Idempotent-ish: an article with a cover or a found og image
//  is skipped next run; a genuine miss is marked so it isn't retried forever.
// ════════════════════════════════════════════════════════════════════════

const OG_RE = /<meta[^>]+(?:property|name)=["'](?:og:image(?::url)?|twitter:image(?::src)?)["'][^>]+content=["']([^"']+)["']/i;
const OG_RE_REV = /<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name)=["'](?:og:image(?::url)?|twitter:image(?::src)?)["']/i;
/** Sentinel stored when a page genuinely has no usable image, so we stop retrying. */
const NONE = "none";

// NOTE: Google News RSS links resolve to a news.google.com page whose real
// publisher URL is buried in obfuscated protobuf, and its only extractable image
// is a SHARED Google News UI asset (identical across articles) — using it would
// put the same wrong picture on every card. So Google-News-sourced articles are
// left to the honest branded placeholder; this reads the publisher's real
// og:image only, which works once feeds carry resolvable article URLs.
function extractOgImage(html: string, baseUrl: string): string | null {
  const head = html.slice(0, 200_000); // meta tags live in <head>; cap the scan
  const m = head.match(OG_RE) ?? head.match(OG_RE_REV);
  const raw = m?.[1]?.trim();
  if (!raw) return null;
  try {
    const abs = new URL(raw, baseUrl); // resolve protocol-relative / relative
    return abs.protocol === "https:" ? abs.toString() : null;
  } catch {
    return null;
  }
}

export interface OgEnrichResult { scanned: number; found: number; missed: number; failed: number }

/**
 * Fill ogImageUrl for the newest articles that have no image yet. Bounded batch;
 * safe to run on a schedule.
 */
export async function enrichArticleImages(limit = 40): Promise<OgEnrichResult> {
  const rows = await prisma.article.findMany({
    where: { coverImageUrl: null, ogImageUrl: null, sourceUrl: { not: null } },
    orderBy: { publishedAt: "desc" },
    take: limit,
    select: { id: true, sourceUrl: true },
  });

  const out: OgEnrichResult = { scanned: rows.length, found: 0, missed: 0, failed: 0 };
  for (const a of rows) {
    try {
      const res = await fetch(a.sourceUrl as string, {
        headers: { "user-agent": "Mozilla/5.0 (compatible; GlobalFightBot/1.0)" },
        signal: AbortSignal.timeout(12_000),
        redirect: "follow",
      });
      if (!res.ok) { out.failed++; continue; }
      const og = extractOgImage(await res.text(), res.url);
      // Store the image, or the sentinel so a genuine miss isn't retried forever.
      await prisma.article.update({ where: { id: a.id }, data: { ogImageUrl: og ?? NONE } });
      if (og) out.found++; else out.missed++;
    } catch {
      out.failed++;
    }
  }
  return out;
}
