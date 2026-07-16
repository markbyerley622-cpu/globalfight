// ════════════════════════════════════════════════════════════════════════
//  BKFC provider — rankings page extractor.
//
//  Each `.rank_item` is a division: a header (division name), a champion
//  headshot, and a numbered contender list. We emit one row per ranked fighter
//  (rank 0 = champion).
//
//  NOTE: rankings are an editorial compilation. This extractor exists but the
//  "bkfc-rankings" ingest source is DISABLED in the ingestion registry
//  (database-right / copyright). It only runs when a licensed basis is added.
// ════════════════════════════════════════════════════════════════════════

import * as cheerio from "cheerio";
import type { BkfcRankingRow } from "../types";
import { clean } from "../normalize";

const FIGHTER_HREF = /\/fighters\/([a-z0-9-]+)/i;

function slugFromHref($el: cheerio.Cheerio<never>): string | null {
  const href = $el.is("a") ? $el.attr("href") : $el.find("a").first().attr("href");
  const m = href?.match(FIGHTER_HREF);
  return m ? m[1].toLowerCase() : null;
}

/** Parse the rankings page into a flat list of divisional ranking rows. */
export function parseRankingsPage(html: string): BkfcRankingRow[] {
  const $ = cheerio.load(html);
  const rows: BkfcRankingRow[] = [];

  $(".rank_item").each((_, item) => {
    const $item = $(item);
    const division = clean($item.find(".rank-card_header .figher-card_heading, .rank-card_header h2").first().text());
    if (!division) return;

    // Champion (the headshot card at the top of the division).
    const champEl = $item.find(".rank-card_headshot_content, .rank-card_headshot").first();
    const champName = clean($item.find(".rank-card_headshot_name").first().text());
    if (champName) {
      rows.push({
        division,
        rank: 0,
        isChampion: true,
        fighterName: champName,
        fighterSlug: slugFromHref(champEl as unknown as cheerio.Cheerio<never>),
      });
    }

    // Numbered contenders.
    $item.find(".rank-card_list_item").each((__, li) => {
      const $li = $(li);
      const cls = $li.attr("class") ?? "";
      if (cls.includes("w-condition-invisible")) return; // empty slot
      const numText = clean($li.find(".rank-card_list_number").first().text());
      const rank = numText ? Number.parseInt(numText.replace(/[^\d]/g, ""), 10) : NaN;
      // Name is the first <p> sibling that is not a hidden conditional.
      const name = $li
        .find("p")
        .toArray()
        .map((p) => ({ cls: $(p).attr("class") ?? "", text: clean($(p).text()) }))
        .find((p) => !p.cls.includes("w-condition-invisible") && p.text)?.text;
      if (!Number.isFinite(rank) || !name) return;
      rows.push({
        division,
        rank,
        isChampion: false,
        fighterName: name,
        fighterSlug: slugFromHref($li as unknown as cheerio.Cheerio<never>),
      });
    });
  });

  return rows;
}
