// ════════════════════════════════════════════════════════════════════════
//  ONE Championship — event page extractor (JSON-LD driven).
//
//  ONE emits a clean schema.org/Event: name, startDate (ISO w/ timezone),
//  and a full Place/PostalAddress (venue, locality, country). We take those and
//  assign a sport from the event slug/name (the "ONE Friday Fights" series is
//  Muay Thai / kickboxing; everything else is treated as mixed MMA).
//
//  The fight CARD is not reliably in the static HTML (loaded dynamically), so
//  events carry no bouts — the schedule only needs name/date/venue.
// ════════════════════════════════════════════════════════════════════════

import * as cheerio from "cheerio";
import { extractJsonLd, findType, str, obj } from "../../bkfc/extract/jsonld";
import { clean, slugFromUrl } from "../../bkfc/normalize";
import type { OneEvent, OneSport } from "../types";

/** Assign a project sport from the event identity. */
export function detectOneSport(slug: string, name: string): OneSport {
  const s = `${slug} ${name}`.toLowerCase();
  if (s.includes("kickbox")) return "KICKBOXING";
  if (s.includes("friday-fights") || s.includes("friday fights") || s.includes("muay") || s.includes("lumpinee")) {
    return "MUAY_THAI";
  }
  return "MMA";
}

/** Validate an ISO datetime string; return it unchanged or null. */
function isoOrNull(value: string | null): string | null {
  if (!value) return null;
  const ms = Date.parse(value);
  if (!Number.isFinite(ms)) return null;
  const year = new Date(ms).getUTCFullYear();
  return year >= 1990 && year <= 2100 ? value : null;
}

/** Parse a ONE event page into a normalized OneEvent. */
export function parseOneEventPage(html: string, url: string, now = new Date()): OneEvent | null {
  const $ = cheerio.load(html);
  const slug = slugFromUrl(url);
  if (!slug) return null;

  const nodes = extractJsonLd($);
  const ld = findType(nodes, "Event");

  const name =
    clean(str(ld, "name")?.replace(/&amp;/g, "&")) ??
    clean($("h1").first().text()) ??
    slug.replace(/-/g, " ");

  const date = isoOrNull(str(ld, "startDate"));
  const place = obj(ld, "location");
  const venue = clean(str(place, "name"));
  const address = obj(place, "address");
  const city = clean(str(address, "addressLocality"));
  const country = clean(str(address, "addressCountry"));

  const posterUrl =
    clean($('meta[property="og:image"]').attr("content")) ??
    clean(str(obj(ld, "image"), "url")) ??
    clean(str(ld, "image"));

  const status: OneEvent["status"] =
    date && Date.parse(date) < now.getTime() - 86_400_000 ? "COMPLETED" : "SCHEDULED";

  return {
    slug,
    url,
    name,
    date,
    venue,
    city,
    country,
    posterUrl,
    sport: detectOneSport(slug, name),
    status,
  };
}
