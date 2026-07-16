// ════════════════════════════════════════════════════════════════════════
//  BKFC provider — event page extractor.
//
//  Strategy: JSON-LD (schema.org/Event) for name, poster, date and venue;
//  cheerio over the Webflow card markup for the bout list.
//
//  IMPORTANT — event RESULTS are intentionally left null. BKFC renders the
//  per-bout winner via a client-side widget (data-cond-key="RedResult"/…),
//  and the static HTML contains all four result variants unmarked — there is
//  no server-rendered winner to read. Fabricating an outcome in a combat-sports
//  registry is worse than a null, so we store the matchup and leave the result
//  SCHEDULED until a licensed results feed (gigcasters) is available.
// ════════════════════════════════════════════════════════════════════════

import * as cheerio from "cheerio";
import type { BkfcEvent, BkfcBout } from "../types";
import {
  clean,
  slugFromUrl,
  parseHumanDate,
  parseEventNumber,
  deriveEventStatus,
  splitLocation,
} from "../normalize";
import { extractJsonLd, findType, str, obj } from "./jsonld";

const FIGHTER_HREF = /\/fighters\/([a-z0-9-]+)/i;

/** Absolute-ise a BKFC-relative URL. */
function abs(href: string | undefined, base = "https://www.bkfc.com"): string | null {
  if (!href) return null;
  try {
    return new URL(href, base).toString();
  } catch {
    return null;
  }
}

/** Parse an event page's HTML into a normalized BkfcEvent. */
export function parseEventPage(html: string, url: string, now = new Date()): BkfcEvent | null {
  const $ = cheerio.load(html);
  const slug = slugFromUrl(url);
  if (!slug) return null;

  const nodes = extractJsonLd($);
  const ld = findType(nodes, "Event");

  const name =
    str(ld, "name") ??
    clean($("h1").first().text()) ??
    slug.replace(/-/g, " ");

  const posterUrl = str(ld, "image");
  const date = parseHumanDate(str(ld, "startDate"));
  const place = obj(ld, "location");
  const venue = str(place, "name");

  // JSON-LD address is usually empty on BKFC; fall back to splitting the venue.
  const address = obj(place, "address");
  let city = str(address, "addressLocality");
  let country = str(address, "addressCountry");
  if (!city && !country) {
    const split = splitLocation(venue);
    city = split.city;
    country = split.country;
  }

  const statusLabel = clean($('[class*="status"], .event-status, .hero_status').first().text());
  const status = deriveEventStatus(date, statusLabel, now);

  // Ticket / watch links: first anchors whose text or href signals them.
  const ticketsUrl = abs(
    $('a[href*="ticket"], a[href*="seatgeek"], a[href*="ticketmaster"]').first().attr("href"),
  );
  const watchUrl = abs(
    $('a[href*="dazn"], a[href*="watch"], a[href*="ppv"], a[href*="/how-to-watch"]')
      .first()
      .attr("href"),
  );

  const bouts = parseBouts($);

  return {
    slug,
    url,
    name,
    number: parseEventNumber(name),
    posterUrl,
    venue,
    city,
    country,
    date,
    status,
    ticketsUrl,
    watchUrl,
    bouts,
  };
}

/** Extract the card, de-duplicating the responsive (mobile/desktop) copies. */
function parseBouts($: cheerio.CheerioAPI): BkfcBout[] {
  const out: BkfcBout[] = [];
  const seen = new Set<string>();

  $("li.fight-card_list-item").each((_, li) => {
    const $li = $(li);
    const anchors = $li.find('a[href*="/fighters/"]');
    if (anchors.length < 2) return;

    const corner = (i: number): { name: string | null; slug: string | null } => {
      const a = anchors.eq(i);
      const name = clean(a.find(".fight-card_name").first().text()) ?? clean(a.attr("aria-label"));
      const href = a.attr("href") ?? "";
      const m = href.match(FIGHTER_HREF);
      return { name, slug: m ? m[1].toLowerCase() : null };
    };

    const red = corner(0);
    const blue = corner(1);
    if (!red.name || !blue.name) return;

    // De-dupe the breakpoint duplicates: same ordered pair = same bout.
    const key = `${red.slug ?? red.name}|${blue.slug ?? blue.name}`;
    if (seen.has(key)) return;
    seen.add(key);

    // Title fight: a belt image that Webflow did NOT hide.
    const titleFight = $li.find(".fight-card_belt").toArray().some((b) => {
      const cls = $(b).attr("class") ?? "";
      return !cls.includes("w-condition-invisible");
    });

    const order = out.length;
    out.push({
      orderOnCard: order,
      redName: red.name,
      blueName: blue.name,
      redSlug: red.slug,
      blueSlug: blue.slug,
      weightClass: clean($li.find(".fight-card_heading").first().text()),
      titleFight,
      mainEvent: order === 0,
      coMain: order === 1,
      scheduledRounds: null,
      // Results are not present in static HTML — see module header.
      redResult: null,
      blueResult: null,
      winnerCorner: null,
      method: null,
      roundEnded: null,
      timeEnded: null,
    });
  });

  return out;
}
