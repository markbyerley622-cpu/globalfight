// ════════════════════════════════════════════════════════════════════════
//  BKFC provider — discovery via sitemap.xml.
//
//  BKFC publishes a complete sitemap (events, fighters, news, static pages),
//  so discovery is a single fetch + a streaming regex scan rather than a crawl
//  queue. Handles both a flat urlset and a sitemap index (fetches child maps).
//  Parsing is regex-over-text (not a DOM load) to keep memory flat on the
//  ~3–4k-URL document.
// ════════════════════════════════════════════════════════════════════════

import { fetchPage } from "../http";
import type { DiscoveredUrls } from "./types";
import { log } from "../logger";

const SITEMAP_URL = process.env.BKFC_SITEMAP_URL ?? "https://www.bkfc.com/sitemap.xml";
const BASE = "https://www.bkfc.com";

const LOC_RE = /<loc>\s*([^<\s]+)\s*<\/loc>/gi;

function extractLocs(xml: string): string[] {
  const out: string[] = [];
  let m: RegExpExecArray | null;
  LOC_RE.lastIndex = 0;
  while ((m = LOC_RE.exec(xml)) !== null) out.push(m[1].trim());
  return out;
}

function classify(urls: string[]): DiscoveredUrls {
  const acc: DiscoveredUrls = { events: [], fighters: [], news: [], other: [] };
  for (const u of urls) {
    let path: string;
    try {
      path = new URL(u).pathname;
    } catch {
      continue;
    }
    if (path.startsWith("/events/")) acc.events.push(u);
    else if (path.startsWith("/fighters/")) acc.fighters.push(u);
    else if (path.startsWith("/news/")) acc.news.push(u);
    else acc.other.push(u);
  }
  return acc;
}

/** Fetch + classify every URL in the BKFC sitemap. */
export async function discover(): Promise<DiscoveredUrls> {
  const root = await fetchPage(SITEMAP_URL);
  let locs = extractLocs(root.html);

  // Sitemap index → the <loc>s are child sitemaps, not pages.
  const looksLikeIndex = /<sitemapindex/i.test(root.html);
  if (looksLikeIndex) {
    const children: string[] = [];
    for (const child of locs) {
      const sub = await fetchPage(child);
      children.push(...extractLocs(sub.html));
    }
    locs = children;
  }

  // Only same-host BKFC URLs.
  locs = locs.filter((u) => u.startsWith(BASE));
  const classified = classify(locs);
  log.info(
    {
      events: classified.events.length,
      fighters: classified.fighters.length,
      news: classified.news.length,
      other: classified.other.length,
    },
    "bkfc:discover",
  );
  return classified;
}
