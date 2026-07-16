// ════════════════════════════════════════════════════════════════════════
//  ONE Championship — discovery via sitemap.xml (streaming regex scan).
// ════════════════════════════════════════════════════════════════════════

import { fetchPage } from "../http";
import { log } from "../logger";

const SITEMAP_URL = process.env.ONE_SITEMAP_URL ?? "https://www.onefc.com/sitemap.xml";
const BASE = "https://www.onefc.com";
const LOC_RE = /<loc>\s*([^<\s]+)\s*<\/loc>/gi;

function extractLocs(xml: string): string[] {
  const out: string[] = [];
  let m: RegExpExecArray | null;
  LOC_RE.lastIndex = 0;
  while ((m = LOC_RE.exec(xml)) !== null) out.push(m[1].trim());
  return out;
}

/** Return every /events/ URL from the ONE sitemap (handles a sitemap index). */
export async function discoverEvents(): Promise<string[]> {
  const root = await fetchPage(SITEMAP_URL);
  let locs = extractLocs(root.html);

  if (/<sitemapindex/i.test(root.html)) {
    const children: string[] = [];
    for (const child of locs) {
      // Only crawl child sitemaps that could hold event URLs.
      if (!/sitemap/i.test(child)) continue;
      try {
        const sub = await fetchPage(child);
        children.push(...extractLocs(sub.html));
      } catch {
        /* skip an unreachable child sitemap */
      }
    }
    locs = children;
  }

  const events = locs.filter((u) => u.startsWith(BASE) && /\/events\/[^/]+\/?$/.test(u));
  const unique = [...new Set(events)];
  log.info({ events: unique.length }, "one:discover");
  return unique;
}
