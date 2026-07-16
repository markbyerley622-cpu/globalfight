// ════════════════════════════════════════════════════════════════════════
//  Wikipedia fight-card extractor (CC BY-SA — the licensed "wikipedia-facts"
//  source). Promotion-agnostic: works for ONE, BKFC, UFC, PFL … any event page
//  that renders the standard results table.
//
//  Layout (class="toccolours", sometimes "wikitable"):
//    | Weight class        | Red fighter | def. | Blue fighter | Method | Round | Time | Notes |
//    | Bantamweight Muay Thai | Rambolek | def. | Opponent   | KO     | 2     | 1:30 |       |
//
//  This is the ONLY source we have for bout RESULTS — neither bkfc.com nor
//  onefc.com expose winners/method in static HTML.
// ════════════════════════════════════════════════════════════════════════

import * as cheerio from "cheerio";

export interface WikiBout {
  weightClass: string | null;
  /** Ruleset words found in the weight-class cell ("Muay Thai", "Kickboxing"). */
  ruleset: string | null;
  redName: string;
  blueName: string;
  /** "def." → red won. "vs." → not yet fought / no result. */
  decided: boolean;
  method: string | null;
  round: number | null;
  time: string | null;
  titleFight: boolean;
}

const RULESETS = ["muay thai", "kickboxing", "submission grappling", "grappling", "boxing", "mma"];

const clean = (s: string): string => s.replace(/\[\d+\]/g, "").replace(/\s+/g, " ").trim();

/**
 * Fighter-name cells carry status markers — "(c)" champion, "(ic)" interim — and
 * footnotes. Strip them or we'd create a separate "Fabrício Andrade (c)" fighter
 * alongside the real one.
 */
const cleanName = (s: string): string =>
  clean(s)
    .replace(/\((?:c|ic|c\/[^)]*|interim[^)]*)\)/gi, "")
    .replace(/\s+/g, " ")
    .trim();

/** Parse every results table on a Wikipedia event page into bouts. */
export function parseWikiCard(html: string): WikiBout[] {
  const $ = cheerio.load(html);
  const out: WikiBout[] = [];

  $("table.toccolours, table.wikitable").each((_, table) => {
    $(table)
      .find("tr")
      .each((__, tr) => {
        const cells = $(tr)
          .find("td")
          .toArray()
          .map((td) => clean($(td).text()));
        if (cells.length < 4) return;

        // A bout row has a "def." / "vs." separator in the 3rd cell.
        const sep = cells[2]?.toLowerCase() ?? "";
        if (!sep.startsWith("def") && !sep.startsWith("vs")) return;

        const redName = cleanName(cells[1]);
        const blueName = cleanName(cells[3]);
        if (!redName || !blueName) return;

        const wcCell = cells[0] ?? "";
        const lower = wcCell.toLowerCase();
        const ruleset = RULESETS.find((r) => lower.includes(r)) ?? null;
        // "(c)" in the weight-class/notes cell also marks a title bout.
        const champMarker = /\(c\)/i.test(cells[1] ?? "") || /\(c\)/i.test(cells[3] ?? "");
        // Strip the ruleset words to leave the division ("Bantamweight").
        const weightClass =
          clean(RULESETS.reduce((acc, r) => acc.replace(new RegExp(r, "ig"), ""), wcCell)) || null;

        const roundRaw = cells[5] ?? "";
        const round = /^\d+$/.test(roundRaw) ? Number.parseInt(roundRaw, 10) : null;

        out.push({
          weightClass,
          ruleset,
          redName,
          blueName,
          decided: sep.startsWith("def"),
          method: clean(cells[4] ?? "") || null,
          round,
          time: /^\d{1,2}:\d{2}$/.test(cells[6] ?? "") ? cells[6] : null,
          titleFight: champMarker || /title|championship|belt/i.test(wcCell + " " + (cells[7] ?? "")),
        });
      });
  });

  return out;
}
