// ════════════════════════════════════════════════════════════════════════════
//  ONE Championship — the FIGHT CARD, read off the event page.
//
//  ── Why this exists ───────────────────────────────────────────────────────
//  The event extractor next door carried this comment, and every ONE card in
//  the database was empty because of it:
//
//      "The fight CARD is not reliably in the static HTML (loaded dynamically),
//       so events carry no bouts"
//
//  That is false, and it was measured false. onefc.com server-renders the whole
//  card into `div.event-matchup` blocks. Across a 30-event sample of the 423
//  events in ONE's sitemap:
//
//      24 events carried a card       247 bouts
//       6 events carried none         all dated 2016-03-18 or earlier
//     247 bouts had both corner links   0 missing fighter names
//     245 bouts named a winner          2 no-contests
//
//  So the card is present from roughly mid-2017 onward, and the pre-2017 gap is
//  a genuine hole in ONE's own CMS — not a parser failure. An event with no
//  matchup blocks yields no bouts, which is the honest outcome.
//
//  ── What a block gives us ─────────────────────────────────────────────────
//    div.title        "Featherweight Muay Thai World Championship"
//    a.face1/.face2   /athletes/<slug>/ — a STABLE external id per corner
//    div.sticker      `is-win` on the winner, `is-no-contest` on a NC
//    .opacity-50      the published finish: "Split Decision (R3)"
//    tr.vs td         both corners' FULL names (div.versus holds short ones)
//
//  The label is the valuable part. ONE runs four rulesets on one card, so the
//  event's sport is false for most bouts on it — the exact defect Fight.ruleset
//  exists to fix. ONE states the ruleset PER BOUT, so we read it rather than
//  derive it (see ../map).
//
//  Verified: div.event-matchup blocks are emitted MAIN EVENT FIRST. On every
//  numbered card sampled (ONE 157/167/168, Fight Night 23) the World
//  Championship bout is block 0.
//
//  This module is PURE and states nothing the page did not. A bout with no
//  winner sticker is SCHEDULED, never a guessed result.
// ════════════════════════════════════════════════════════════════════════════

import type { CheerioAPI, Cheerio } from "cheerio";
import type { Element } from "domhandler";
import { clean } from "../../bkfc/normalize";
import { normalizeText } from "@/lib/text/entities";
import { athleteSlug } from "../results";
import type { OneMatchup } from "../types";

/**
 * Ruleset wording ONE appends to the weight class. Stripped to leave the weight
 * class alone; the ruleset itself is read from the full label by ../map.
 *
 * "kickboxing" precedes "boxing" so the alternation cannot bite off the tail of
 * the longer word — though `\b` already prevents it, the order documents intent.
 */
const RULESET_WORDS =
  /\b(?:mixed martial arts|submission grappling|muay\s*thai|kickboxing|boxing|grappling|jiu[\s-]?jitsu|bjj|mma)\b/gi;

/** ONE's marker for a championship bout. A Grand Prix final is NOT one. */
const WORLD_TITLE = /\bworld\s+(?:championship|title)\b/i;

/** Read the text of an element, entity-decoded and whitespace-collapsed. */
function text($: CheerioAPI, el: Cheerio<Element>): string | null {
  if (el.length === 0) return null;
  return clean(normalizeText(el.first().text()));
}

/**
 * The weight class, with ONE's ruleset and championship wording removed.
 *
 *   "Flyweight Muay Thai"                        → "Flyweight"
 *   "140 LBS Muay Thai"                          → "140 LBS"
 *   "Interim Lightweight MMA World Championship" → "Lightweight"
 *   "Women's Atomweight World Championship"      → "Women's Atomweight"
 *   "Catchweight [68.0 KG]"                      → "Catchweight [68.0 KG]"
 *
 * Everything from "World" onward is title/tournament billing rather than a
 * division, so it is dropped — that also disposes of "World Grand Prix
 * Championship Final" in one rule instead of three.
 */
export function weightClassFromLabel(label: string | null): string | null {
  if (!label) return null;
  const stripped = label
    .replace(/^\s*interim\s+/i, "")
    .replace(/\bworld\b.*$/i, "")
    .replace(RULESET_WORDS, " ");
  return clean(stripped.replace(/\s+/g, " "));
}

/** The finishing round from ONE's "(R3)" suffix. "(R)" states none. */
export function roundFromMethodText(methodText: string | null): number | null {
  const m = methodText?.match(/\(R(\d+)\)/i);
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/**
 * Both corners' full names, from the stats table.
 *
 * `div.versus` holds ONE's SHORT billing ("Petninmungkorn vs. Pet"), which is
 * ambiguous across a roster full of shared Thai ring names. `tr.vs` holds the
 * full form ("Petninmungkorn NamkangIceland"), so that is what identity gets.
 */
function cornerNames($: CheerioAPI, block: Cheerio<Element>): [string, string] | null {
  const cells = block.find("tr.vs td");
  if (cells.length < 2) return null;
  const red = text($, cells.eq(0));
  const blue = text($, cells.eq(cells.length - 1));
  // Half a bout is worse than no bout: a corner we cannot name cannot be
  // resolved, and persisting it would invent a fighter from an empty string.
  if (!red || !blue) return null;
  return [red, blue];
}

/** Parse every fight-card block on a ONE event page, main event first. */
export function parseOneMatchups($: CheerioAPI): OneMatchup[] {
  const out: OneMatchup[] = [];

  $("div.event-matchup").each((_, el) => {
    const block = $(el);

    const names = cornerNames($, block);
    if (!names) return;
    const [redName, blueName] = names;

    const face1 = block.find("a.face1").first();
    const face2 = block.find("a.face2").first();
    const sticker1 = face1.find("div.sticker").first();
    const sticker2 = face2.find("div.sticker").first();

    // The winner is the corner ONE stamped, never an inference from the method.
    const winner: OneMatchup["winner"] = sticker1.hasClass("is-win")
      ? "red"
      : sticker2.hasClass("is-win")
        ? "blue"
        : null;

    // `.opacity-50` is the long-form finish ("Split Decision (R3)"); the sibling
    // span repeats it abbreviated for narrow viewports, so only the first is read.
    const methodText =
      text($, sticker1.find(".opacity-50")) ?? text($, sticker2.find(".opacity-50"));

    const label = text($, block.children("div.title"));

    // A no-contest is stamped on BOTH corners, so either one proves it. The text
    // check is a second, class-independent witness.
    const noContest =
      sticker1.hasClass("is-no-contest") ||
      sticker2.hasClass("is-no-contest") ||
      /no contest/i.test(methodText ?? "");

    out.push({
      order: out.length,
      redName,
      blueName,
      redExternalId: athleteSlug(face1.attr("href")),
      blueExternalId: athleteSlug(face2.attr("href")),
      label,
      weightClass: weightClassFromLabel(label),
      titleFight: WORLD_TITLE.test(label ?? ""),
      winner,
      methodText,
      round: roundFromMethodText(methodText),
      noContest,
    });
  });

  return out;
}
