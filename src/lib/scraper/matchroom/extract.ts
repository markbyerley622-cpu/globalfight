// ════════════════════════════════════════════════════════════════════════════
//  Matchroom event page → a card. PURE: no network, no persistence.
//
//  WHY THIS PROVIDER EXISTS, when the ladder first called Matchroom "thin":
//
//  That verdict was reached against a PAST event page, which carries only the
//  headline bout and a one-line result — genuinely worse than Wikipedia, which
//  had the full card. But Wikipedia writes a boxing card up around or AFTER the
//  fight, so it can build an archive and can never build a schedule. Boxing had
//  ONE upcoming event against 149 historical.
//
//  An UPCOMING Matchroom page is a different document: date, venue, broadcaster,
//  a tickets link, the headline bout and the full undercard with title
//  designations. For the forward schedule it is not the weakest source
//  available, it is the best one.
//
//  No JSON-LD (the only ld+json block is a WebPage node), so this reads the DOM.
//  The classes are semantic and stable — .event-title, .event-date, .fight,
//  .boxer-1 / .boxer-2, .vs .additional-information — and each is asserted by a
//  fixture test so a redesign fails loudly instead of silently returning zero.
// ════════════════════════════════════════════════════════════════════════════

import * as cheerio from "cheerio";

export interface MatchroomBout {
  redName: string;
  blueName: string;
  /** "WBO World Super Middleweight Title" when the page marks one. */
  note: string | null;
  titleFight: boolean;
}

export interface MatchroomCard {
  name: string;
  /** ISO, midday UTC. Null when the page states no parseable date. */
  date: string | null;
  venue: string | null;
  broadcaster: string | null;
  ticketUrl: string | null;
  bouts: MatchroomBout[];
}

const clean = (s: string): string => s.replace(/\s+/g, " ").trim();

/**
 * "Saturday 25 July 2026" → ISO at midday UTC.
 *
 * Midday, not midnight: a bare calendar date stored as midnight UTC renders as
 * the previous day everywhere west of Greenwich, and a card's date is a
 * date-only fact. Same rule as the tournament provider's parseWikiDate.
 */
export function parseMatchroomDate(text: string): string | null {
  if (!text) return null;
  const MONTHS = "january|february|march|april|may|june|july|august|september|october|november|december";
  const m = new RegExp(`\\b(\\d{1,2})\\s+(${MONTHS})\\s+((?:19|20)\\d{2})\\b`, "i").exec(text);
  if (!m) return null;
  const day = Number.parseInt(m[1], 10);
  const month = MONTHS.split("|").indexOf(m[2].toLowerCase());
  const year = Number.parseInt(m[3], 10);
  if (month < 0 || day < 1 || day > 31) return null;
  const d = new Date(Date.UTC(year, month, day, 12, 0, 0));
  return Number.isNaN(+d) ? null : d.toISOString();
}

/** A boxer name from a `.boxer-N h2`, which splits first/last across spans. */
function boxerName($: cheerio.CheerioAPI, el: cheerio.Cheerio<never>): string {
  return clean(el.find("h2").first().text());
}

/** Broadcasters Matchroom names in page copy. Read, never guessed. */
const BROADCASTERS = ["DAZN", "Sky Sports", "ESPN", "Peacock", "TNT Sports"];

export function parseMatchroomEvent(html: string): MatchroomCard | null {
  const $ = cheerio.load(html);

  const name = clean($(".event-title").first().text());
  if (!name) return null; // not an event page

  const date = parseMatchroomDate(clean($(".event-date").first().text()));

  // Venue is not in a dedicated element on every card; when it is absent it
  // stays null rather than being scraped out of prose.
  const venue = clean($(".event-venue, .event-location").first().text()) || null;

  const body = clean($("body").text());
  const broadcaster = BROADCASTERS.find((b) => body.includes(b)) ?? null;

  const ticketUrl =
    $('a[href*="ticket"], a[href*="webook"], a[href*="axs"], a[href*="seatgeek"]').first().attr("href") ?? null;

  const bouts: MatchroomBout[] = [];
  $(".fight").each((_, el) => {
    const fight = $(el) as unknown as cheerio.Cheerio<never>;
    const redName = boxerName($, fight.find(".boxer-1") as unknown as cheerio.Cheerio<never>);
    const blueName = boxerName($, fight.find(".boxer-2") as unknown as cheerio.Cheerio<never>);
    if (!redName || !blueName) return;

    const note = clean($(el).find(".vs .additional-information").first().text()) || null;
    bouts.push({
      redName,
      blueName,
      note,
      // The page marks a championship bout by naming the belt in the same slot.
      titleFight: /\btitle\b|\bchampionship\b/i.test(note ?? ""),
    });
  });

  return { name, date, venue, broadcaster, ticketUrl, bouts };
}
