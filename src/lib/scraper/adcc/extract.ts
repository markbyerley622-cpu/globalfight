// ════════════════════════════════════════════════════════════════════════
//  ADCC — events listing extractor (static WordPress DOM).
//
//  Each <article> on /adcc-events/ is one event: split date (month/day/year),
//  title + permalink, location, and a poster image.
// ════════════════════════════════════════════════════════════════════════

import * as cheerio from "cheerio";
import { clean, slugFromUrl, parseHumanDate } from "../bkfc/normalize";
import type { AdccEvent } from "./types";

/** Split a long ADCC location into a venue + a best-effort city. */
function splitVenue(loc: string | null): { venue: string | null; city: string | null; country: string | null } {
  if (!loc) return { venue: null, city: null, country: null };
  const parts = loc.split(",").map((p) => p.trim()).filter(Boolean);
  if (parts.length <= 1) return { venue: loc, city: null, country: null };
  return { venue: parts[0], city: parts[parts.length - 1], country: null };
}

/** Parse the ADCC events listing page into events. */
export function parseAdccEventsPage(html: string, now = new Date()): AdccEvent[] {
  const $ = cheerio.load(html);
  const out: AdccEvent[] = [];
  const seen = new Set<string>();

  $("article").each((_, art) => {
    const $a = $(art);
    const link = $a.find("h2.entry-title a, .entry-title a").first();
    const url = link.attr("href");
    const name = clean(link.text());
    if (!url || !name) return;
    const slug = slugFromUrl(url);
    if (!slug || seen.has(slug)) return;

    const month = clean($a.find(".rw-date-month").first().text());
    const day = clean($a.find(".rw-date-day").first().text());
    const year = clean($a.find(".rw-date-year").first().text());
    const date = month && day && year ? parseHumanDate(`${month} ${day} ${year}`) : null;
    if (!date) return; // an events listing row without a date is not usable

    seen.add(slug);
    const { venue, city, country } = splitVenue(clean($a.find(".rw-event-location").first().text()));
    const posterUrl = clean($a.find(".rw-post-image img").first().attr("src"));
    const status: AdccEvent["status"] =
      Date.parse(date) < now.getTime() - 86_400_000 ? "COMPLETED" : "SCHEDULED";

    out.push({ slug, url, name, date, venue, city, country, posterUrl, status });
  });

  return out;
}
