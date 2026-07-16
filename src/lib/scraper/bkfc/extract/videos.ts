// ════════════════════════════════════════════════════════════════════════
//  BKFC provider — video extractor.
//
//  Pulls YouTube embeds/links from any page. Only YouTube-identifiable videos
//  carry a stable id (the FeedVideo primary key), so those are the ones the
//  ingest layer can persist; other embeds (gigcasters PPV) are returned for
//  completeness but have youtubeId === null and are not written to FeedVideo.
// ════════════════════════════════════════════════════════════════════════

import * as cheerio from "cheerio";
import type { BkfcVideo } from "../types";
import { clean, extractYouTubeId } from "../normalize";

/** Extract distinct videos referenced on a page. */
export function parseVideos(html: string, contextTitle?: string): BkfcVideo[] {
  const $ = cheerio.load(html);
  const out: BkfcVideo[] = [];
  const seen = new Set<string>();

  const add = (url: string | undefined, title: string | null) => {
    const u = clean(url);
    if (!u) return;
    const youtubeId = extractYouTubeId(u);
    const key = youtubeId ?? u;
    if (seen.has(key)) return;
    seen.add(key);
    out.push({
      title: title ?? clean(contextTitle) ?? "BKFC video",
      url: youtubeId ? `https://www.youtube.com/watch?v=${youtubeId}` : u,
      youtubeId,
      thumbnail: youtubeId ? `https://i.ytimg.com/vi/${youtubeId}/hqdefault.jpg` : null,
      description: null,
      publishedAt: null,
    });
  };

  $('iframe[src*="youtube.com"], iframe[src*="youtu.be"]').each((_, el) => {
    add($(el).attr("src"), clean($(el).attr("title")));
  });
  $('a[href*="youtube.com"], a[href*="youtu.be"]').each((_, el) => {
    add($(el).attr("href"), clean($(el).text()));
  });

  return out;
}
