// ════════════════════════════════════════════════════════════════════════════
//  Year round-up pages: one article, many cards.
//
//  PURE. No prisma, no network.
//
//  Some promotions never get a per-card article. Everything ONE Championship and
//  GLORY ran in a year is written up on ONE page — "2019 in ONE Championship",
//  "2025 in Glory" — and the existing paths both fail on it for the SAME reason,
//  from opposite directions:
//
//    wikicard        searches for the card, lands on the year page, and the
//                    verifier rejects it — correctly. A year page is not the card.
//    promotion-index sees 140 index rows all linking to that one article and the
//                    shared-article guard refuses them — also correctly. Otherwise
//                    every card would claim the whole season's bouts.
//
//  Neither is a bug and neither should be loosened. The missing capability is to
//  SPLIT the page back into the cards it is a concatenation of.
//
//  The shape is stable across both promotions and across eras (verified against
//  2019/2026 ONE and 2025 GLORY): each card is an infobox carrying its name, date
//  and venue, immediately followed by its results table.
//
//    table.infobox    "Glory 98" | Promotion Glory | Date February 22, 2025
//    table            "Glory 98 (DAZN)" | Weight Class Method Round Time Notes
//                     ...bout rows...
//
//  So this module ONLY sections. Bout rows are handed to parseWikiCard, which
//  already reads exactly that table — there is no second bout parser here, and a
//  fix to the extractor reaches this path for free.
// ════════════════════════════════════════════════════════════════════════════

import * as cheerio from "cheerio";
import type { Element } from "domhandler";
import { parseWikiDate } from "../tournament/wiki";

export interface YearPageSection {
  /** The card's name as the infobox states it ("ONE Championship: Eternal Glory"). */
  name: string;
  /** The caption on the results table ("ONE: Eternal Glory") — often a different form. */
  caption: string | null;
  /** ISO date, as parseWikiDate returns it — the form the persistence layer takes. */
  date: string | null;
  venue: string | null;
  city: string | null;
  /** The results table's markup, ready for parseWikiCard. */
  cardHtml: string;
}

export interface YearPageReport {
  /** Infoboxes that looked like an event but yielded no usable card, and why. */
  skipped: { name: string; why: string }[];
}

/** A results table's header row — the columns parseWikiCard needs to read it. */
const CARD_HEADER = /weight\s*class/i;
const CARD_HEADER_2 = /method/i;

/**
 * The page's OWN infobox ("2025 in Glory") is not an event. It is distinguished
 * structurally rather than by title: a card infobox states the promotion that ran
 * it and the single date it ran on, and the page infobox states neither — it has
 * "First date"/"Last date" instead. Matching on structure means a promotion whose
 * card is literally named for a year is still read correctly.
 */
const labelled = (
  $: cheerio.CheerioAPI,
  box: Element,
  label: RegExp,
): string | null => {
  for (const row of $(box).find("tr").toArray()) {
    const th = $(row).find("th").first();
    if (!th.length) continue;
    if (!label.test(clean(th.text()))) continue;
    const td = $(row).find("td").first();
    const v = clean(td.text());
    if (v) return v;
  }
  return null;
};

const clean = (s: string): string => s.replace(/\[\d+\]/g, "").replace(/\s+/g, " ").trim();

/**
 * Split a year round-up into its constituent cards.
 *
 * Returns only sections that have BOTH an identity (name + date) and a results
 * table. An infobox missing either is reported in `skipped` rather than emitted:
 * a card with no bouts is the empty-card problem this is meant to solve, not a
 * partial win.
 */
export function splitYearPage(html: string): { sections: YearPageSection[]; report: YearPageReport } {
  const $ = cheerio.load(html);
  // A line break is a word boundary. Without this, an infobox title split over two
  // lines reads back as "Glory 108RISE World Series 2026 Tokyo" — one token, and a
  // name no lookup will ever match.
  $("br").replaceWith(" ");
  const sections: YearPageSection[] = [];
  const skipped: YearPageReport["skipped"] = [];

  for (const box of $("table.infobox").toArray()) {
    const name = clean($(box).find("tr").first().text());
    if (!name) continue;

    // Structural test for "is this a card, or the page's own infobox?".
    const promotion = labelled($, box, /^promotion$/i);
    const dateText = labelled($, box, /^date$/i);
    if (!promotion && !dateText) continue; // the page infobox — not an event, not a miss

    const date = dateText ? parseWikiDate(dateText) : null;
    if (!date) {
      skipped.push({ name, why: "no parseable date" });
      continue;
    }

    // The card is the first RESULTS table after this infobox — scanning forward,
    // because a year page also carries bracket, title-fight and award tables and
    // an event's card is not always the very next one (Glory Collision 8 leads
    // with a tournament bracket). The scan stops at the next infobox, so a card
    // can never be attached to the event before it: that bound is what makes
    // forward scanning safe rather than greedy.
    const following = $(box).nextAll("table.infobox").first();
    let card: cheerio.Cheerio<Element> | null = null;
    for (const t of $(box).nextAll("table").toArray()) {
      if (following.length && following.is(t)) break;
      const el = $(t);
      const headerText = clean(el.find("tr").slice(0, 2).text());
      if (CARD_HEADER.test(headerText) && CARD_HEADER_2.test(headerText)) {
        card = el;
        break;
      }
    }
    if (!card) {
      skipped.push({ name, why: "no results table before the next event" });
      continue;
    }
    const next = card;

    const caption = clean(next.find("tr").first().text()) || null;
    sections.push({
      name,
      caption: caption && caption !== name ? caption : null,
      date,
      venue: labelled($, box, /^venue$/i),
      city: labelled($, box, /^(city|location)$/i),
      cardHtml: $.html(next),
    });
  }

  return { sections, report: { skipped } };
}
