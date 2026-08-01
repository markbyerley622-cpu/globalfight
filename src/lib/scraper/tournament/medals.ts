// ════════════════════════════════════════════════════════════════════════
//  Medal table → the FINAL bout only. PURE — no network, no prisma.
//
//  Sambo and ADCC/BJJ are the sports the bracket parser cannot serve: English
//  Wikipedia carries no per-division sub-articles and no elimination trees for
//  them, only
//
//      | Division | Gold | Silver | Bronze |
//
//  From that, exactly ONE bout is recoverable, and only one: in single-
//  elimination the gold and silver medallists are the two who contested the
//  final, and gold won it. That is a fact the table states, not a guess.
//
//  What is NOT recoverable, and is therefore never emitted:
//    • the bronze matches — the table names the bronze medallists but not who
//      they beat, and with repechage there are usually two of them;
//    • any earlier round;
//    • the method, the score, or how long it took.
//
//  Every bout from here is tagged origin:"medal-final" and counted separately in
//  the report, because a derived bout and a bout read off a bracket are not the
//  same evidential thing and the operator should never have to guess which they
//  are looking at.
// ════════════════════════════════════════════════════════════════════════

import * as cheerio from "cheerio";
import type { Element } from "domhandler";
import { toCountryCode } from "@/lib/countries";
import type { TournamentBout } from "./types";

export interface MedalFinal extends TournamentBout {
  division: string;
  /** True when the section heading above the table says "combat sambo". */
  combat: boolean;
}

/** A medal-by-event table, as opposed to the medals-per-nation summary table. */
function isEventMedalTable(head: string[]): boolean {
  const joined = head.join(" | ").toLowerCase();
  if (!joined.includes("gold") || !joined.includes("silver")) return false;
  // "Rank | Nation | Gold | Silver | Bronze | Total" counts medals per country —
  // its "Gold" column holds the number 4, not a person.
  if (/\b(rank|nation|noc)\b/.test(joined)) return false;
  return true;
}

/**
 * The person named in a medal cell.
 *
 * The cell mixes a person with their nation and often their team:
 *   "Giorgi Sardalashvili Georgia"   links: [Giorgi Sardalashvili, Georgia (country)]
 *   "Yuri SimõesCTA"                 links: [Brazil, Yuri Simões]
 *   "Sayan Khertek FIAS"             links: [Sayan Khertek (page does not exist)]
 *
 * Link ORDER is not stable between articles, so the country link is identified
 * and rejected rather than assumed to be first or last.
 */
function personFrom($: cheerio.CheerioAPI, cell: Element): { name: string; country: string | null } | null {
  // Work on a COPY, and strip by STRUCTURE rather than by guessing at names.
  //
  // The cell is laid out the same way across these articles:
  //   <span class="flagicon"><a title="Australia"></a></span>
  //   <a title="Craig Jones (BJJ)">Craig Jones</a>
  //   <br><small><a title="B Team Jiu Jitsu">B-Team</a></small>
  //
  // Two things follow, and both were learned by getting them wrong:
  //   • the flag anchor carries the country in its TITLE and has no text, so
  //     skipping empty-text anchors threw the country away;
  //   • the gym is always inside <small>, so removing that element is exact.
  //     Matching gym-ish WORDS instead was not: "Craig Jones (BJJ)" matched the
  //     team pattern, the person link was dropped along with the team, nothing
  //     was left, and the -99 kg final silently disappeared from the card.
  const $cell = $(cell).clone();

  let country: string | null = null;
  const flag = $cell.find("span.flagicon a[title]").first().attr("title");
  if (flag) country = toCountryCode(flag)?.toUpperCase() ?? null;

  $cell.find("span.flagicon, small, sup").remove();

  // A nation can also be a plain link beside the name ("Giorgi Sardalashvili
  // Georgia" in the judo tables). Record it, then take it out of the running.
  for (const a of $cell.find("a[title]").toArray()) {
    const title = ($(a).attr("title") ?? "").replace(/\s*\(page does not exist\)\s*$/i, "").trim();
    if (!title) continue;
    const bare = title.replace(/\s*\(country\)\s*$/i, "").replace(/\s+at the\s+.*$/i, "");
    const code = toCountryCode(bare);
    // The length guard keeps a three-letter surname from being read as a nation.
    if (code && bare.length > 3) {
      country ??= code.toUpperCase();
      $(a).remove();
    }
  }

  const raw = $cell.text().replace(/\[\w+\]/g, "").replace(/\s+/g, " ").trim();
  // The first surviving link is the person; otherwise read what is left of the text.
  let name = $cell.find("a").first().text().trim() || raw;
  if (!name) return null;

  // A printed alpha-3 ("Vakhtangi Chidrashvili (GEO)") is the country when no
  // nation link supplied one.
  const coded = /\(([A-Za-z]{2,4})\)\s*$/.exec(raw);
  if (!country && coded) country = coded[1].toUpperCase();

  name = name
    .replace(/\s*\([A-Za-z]{2,4}\)\s*$/, "")
    // Neutral-athlete / federation markers are not part of a name.
    .replace(/\s*(FIAS|AIN|EOR|UWW|IJF)\s*$/i, "")
    .trim();

  if (name.length < 3 || name.length > 60) return null;
  return { name, country };
}

/**
 * The nearest section heading above a table — how combat sambo is distinguished
 * from sport sambo, which share one championship page and one table layout.
 *
 * `div.mw-heading` is in the selector because it has to be: the current parser
 * output wraps every heading as `<div class="mw-heading"><h3>…</h3></div>`, so a
 * table's previous SIBLINGS are those divs and never a bare h2/h3. Matching only
 * on heading tags found nothing, silently filed all 21 sambo finals under sport
 * sambo, and lost the combat-sambo half of the championship.
 */
function headingAbove($: cheerio.CheerioAPI, table: Element): string {
  const SEL = "h2,h3,h4,div.mw-heading";
  const text = (sel: cheerio.Cheerio<Element>): string =>
    (sel.find(".mw-headline").text() || sel.text() || "").replace(/\s+/g, " ").trim();

  const prev = $(table).prevAll(SEL).first();
  if (text(prev)) return text(prev);

  // Nested one level deeper (inside a section/div wrapper) — walk out and retry.
  const outer = $(table).parents("section,div").first().prevAll(SEL).first();
  return text(outer);
}

/**
 * Every division final derivable from a championship page's medal tables.
 *
 * Team events are skipped: "Mixed team" names a country, not two fighters.
 */
export function parseMedalFinals(html: string): MedalFinal[] {
  const $ = cheerio.load(html);
  const out: MedalFinal[] = [];
  const seen = new Set<string>();

  $("table.wikitable").each((_, table) => {
    const rows = $(table).find("tr").toArray();
    if (rows.length < 2) return;
    const head = $(rows[0])
      .find("th,td")
      .toArray()
      .map((c) => $(c).text().replace(/\s+/g, " ").trim());
    if (!isEventMedalTable(head)) return;

    const combat = /combat/i.test(headingAbove($, table));

    for (const tr of rows.slice(1)) {
      const cells = $(tr).find("th,td").toArray();
      // A gold/silver/bronze row. Continuation rows (the second bronze) carry
      // fewer cells and no division, and are skipped by this check.
      if (cells.length < 3) continue;
      const division = $(cells[0]).text().replace(/\[\w+\]/g, "").replace(/details\s*$/i, "").replace(/\s+/g, " ").trim();
      if (!division || division.length > 60) continue;
      if (/team/i.test(division)) continue;

      const gold = personFrom($, cells[1]);
      const silver = personFrom($, cells[2]);
      if (!gold || !silver) continue;
      if (gold.name.toLowerCase() === silver.name.toLowerCase()) continue;

      const key = `${division.toLowerCase()}|${gold.name.toLowerCase()}|${silver.name.toLowerCase()}`;
      if (seen.has(key)) continue;
      seen.add(key);

      out.push({
        division,
        combat,
        round: "Final",
        rank: 100,
        redName: gold.name,
        redCountry: gold.country,
        blueName: silver.name,
        blueCountry: silver.country,
        // The one thing the table does establish.
        winner: "red",
        redScore: null,
        blueScore: null,
        origin: "medal-final",
      });
    }
  });

  return out;
}
