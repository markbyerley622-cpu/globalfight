// ════════════════════════════════════════════════════════════════════════
//  A promotion's Wikipedia EVENT INDEX → one row per card. PURE.
//
//  Some promotions have no API, no JSON endpoint and no embedded JSON — their
//  own site is a merch store — but Wikipedia maintains a numbered index of every
//  card they have run, each row linking to that card's own article:
//
//    | No. | Event                   | Headline                  | Date            | Location |
//    | 1   | MF & DAZN: X Series 001 | KSI vs. Luis Alcaraz Pineda | 27 August 2022 | The O2 Arena, London, England |
//
//  This reads the index. The linked article is then fetched and parsed by the
//  EXISTING wikicard extractor — the bout table there is the same shape it
//  already reads for every other promotion, so there is no second card parser.
//
//  Columns are matched BY HEADER NAME, never by position: the upcoming-events
//  table on the same page carries an extra "Titles(s)" column, so a fixed index
//  reads the date out of the titles cell.
// ════════════════════════════════════════════════════════════════════════

import * as cheerio from "cheerio";
import type { Element } from "domhandler";
import { parseWikiDate } from "../tournament/wiki";

export interface IndexedEvent {
  /** Event name as the promotion bills it ("MF & DAZN: X Series 001"). */
  name: string;
  /** "KSI vs. Luis Alcaraz Pineda", when the index carries one. */
  headline: string | null;
  /** ISO date, or null when the cell held nothing parseable. */
  date: string | null;
  venue: string | null;
  city: string | null;
  country: string | null;
  /**
   * The Wikipedia article for THIS CARD, taken from the row's first link.
   * Null means the index lists the event but no article exists — which is a
   * source limit, recorded rather than guessed at.
   */
  article: string | null;
}

const clean = (s: string): string =>
  s.replace(/\[\w+\]/g, "")
    // "—.mw-parser-output .sr-only{…}" — screen-reader CSS leaks into cell text.
    .replace(/\.mw-parser-output[^}]*}/g, "")
    .replace(/\s+/g, " ")
    .trim();

/** Header cells, lower-cased, with the column index each occupies. */
function headerMap($: cheerio.CheerioAPI, table: Element): Map<string, number> {
  const map = new Map<string, number>();
  const first = $(table).find("tr").first();
  first.find("th,td").each((i, c) => {
    const key = clean($(c).text()).toLowerCase().replace(/\(s\)/g, "").trim();
    if (key && !map.has(key)) map.set(key, i);
  });
  return map;
}

const pick = (map: Map<string, number>, ...names: string[]): number | undefined => {
  for (const n of names) {
    const i = map.get(n);
    if (i !== undefined) return i;
  }
  return undefined;
};

/**
 * An index table is one with an Event (or Headline) column AND a Date column.
 * The same article also carries champion rosters and PPV-buy tables, which have
 * neither pairing and are skipped.
 */
function isIndexTable(map: Map<string, number>): boolean {
  const hasName = pick(map, "event", "headline", "card") !== undefined;
  const hasDate = pick(map, "date") !== undefined;
  return hasName && hasDate;
}

/**
 * "The O2 Arena, London, England" → venue / city / country.
 * A two-part value ("Dubai, UAE") is city + country with no venue.
 */
function splitLocation(raw: string): { venue: string | null; city: string | null; country: string | null } {
  const parts = raw.split(",").map((p) => p.trim()).filter(Boolean);
  if (!parts.length) return { venue: null, city: null, country: null };
  if (parts.length === 1) return { venue: null, city: parts[0], country: null };
  if (parts.length === 2) return { venue: null, city: parts[0], country: parts[1] };
  return { venue: parts[0], city: parts[1], country: parts[parts.length - 1] };
}

/** Every card listed on a promotion's Wikipedia index page. */
export function parseEventIndex(html: string): IndexedEvent[] {
  const $ = cheerio.load(html);
  const out: IndexedEvent[] = [];
  const seen = new Set<string>();

  $("table.wikitable").each((_, table) => {
    const head = headerMap($, table);
    if (!isIndexTable(head)) return;

    const iEvent = pick(head, "event", "card");
    const iHeadline = pick(head, "headline");
    const iDate = pick(head, "date")!;
    const iLoc = pick(head, "location", "venue");

    $(table).find("tr").slice(1).each((__, tr) => {
      const cells = $(tr).find("th,td").toArray();
      if (cells.length < 2) return;

      const text = (i: number | undefined): string =>
        i === undefined || !cells[i] ? "" : clean($(cells[i]).text());

      const rawName = text(iEvent);
      const headline = text(iHeadline) || null;
      // A row whose Event cell is a placeholder ("—", "N/a", "TBA") still names
      // the card in its headline.
      const name = /^[—\-–]?\s*(n\/a|tba|tbd)?$/i.test(rawName) ? (headline ?? "") : rawName;
      if (!name || name.length > 120) return;

      const date = parseWikiDate(text(iDate));
      const loc = splitLocation(text(iLoc));

      // The card's own article: the first real wiki link in the name/headline
      // cells. Red links ("(page does not exist)") are not articles.
      let article: string | null = null;
      for (const i of [iEvent, iHeadline]) {
        if (i === undefined || !cells[i]) continue;
        const a = $(cells[i]).find("a[title]").first();
        const title = (a.attr("title") ?? "").trim();
        if (title && !/\(page does not exist\)$/i.test(title)) { article = title; break; }
      }

      const key = `${name.toLowerCase()}|${date ?? ""}`;
      if (seen.has(key)) return;
      seen.add(key);

      out.push({ name, headline, date, ...loc, article });
    });
  });

  return out;
}
