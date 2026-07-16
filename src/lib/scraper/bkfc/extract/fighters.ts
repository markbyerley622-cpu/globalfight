// ════════════════════════════════════════════════════════════════════════
//  BKFC provider — fighter profile extractor.
//
//  JSON-LD (schema.org/Person) gives name + image; the Webflow hero/stat
//  markup gives the W-L-D record, division, reach and height. Every field is
//  optional — a missing stat is stored as null, never guessed.
// ════════════════════════════════════════════════════════════════════════

import * as cheerio from "cheerio";
import type { BkfcFighter, BkfcRecord, BkfcSocial } from "../types";
import { clean, slugFromUrl, parseRecord, parseLengthCm, parseStance, socialPlatform } from "../normalize";
import { extractJsonLd, findType, str } from "./jsonld";

/** Pull a nickname out of a quoted name: `Jim 'The Beast' Alers` → "The Beast". */
function nicknameFrom(name: string): { clean: string; nickname: string | null } {
  const m = name.match(/["'“”‘’]([^"'“”‘’]{2,40})["'“”‘’]/);
  if (!m) return { clean: name, nickname: null };
  const nickname = clean(m[1]);
  const stripped = clean(name.replace(m[0], " ")) ?? name;
  return { clean: stripped, nickname };
}

/** Read the W-L-D record from the hero record widget. */
function parseHeroRecord($: cheerio.CheerioAPI): BkfcRecord | null {
  const values: Record<string, number> = {};
  $(".hero_record_item").each((_, item) => {
    const $item = $(item);
    const label = clean($item.find("p").last().text())?.toLowerCase() ?? "";
    // The visible number is the .hero_record_number WITHOUT w-condition-invisible.
    const numText = $item
      .find(".hero_record_number")
      .toArray()
      .map((n) => ({ cls: $(n).attr("class") ?? "", text: clean($(n).text()) }))
      .find((n) => !n.cls.includes("w-condition-invisible"))?.text;
    const num = numText != null ? Number.parseInt(numText, 10) : NaN;
    if (!Number.isFinite(num)) return;
    if (label.startsWith("win")) values.wins = num;
    else if (label.startsWith("loss") || label.startsWith("lose")) values.losses = num;
    else if (label.startsWith("draw")) values.draws = num;
  });
  if (values.wins == null && values.losses == null) return null;
  return {
    wins: values.wins ?? 0,
    losses: values.losses ?? 0,
    draws: values.draws ?? 0,
    noContests: 0,
  };
}

/** Read the label→value stat list. */
function readStats($: cheerio.CheerioAPI): Map<string, cheerio.Cheerio<never>> {
  const map = new Map<string, cheerio.Cheerio<never>>();
  $(".stat_list-item").each((_, li) => {
    const $li = $(li);
    const label = clean($li.find(".stat_list-item_label").first().text())?.toLowerCase();
    if (label) map.set(label, $li as unknown as cheerio.Cheerio<never>);
  });
  return map;
}

/** Parse a fighter page's HTML into a normalized BkfcFighter. */
export function parseFighterPage(html: string, url: string): BkfcFighter | null {
  const $ = cheerio.load(html);
  const slug = slugFromUrl(url);
  if (!slug) return null;

  const nodes = extractJsonLd($);
  const person = findType(nodes, "Person");

  const rawName = str(person, "name") ?? clean($("h1").first().text()) ?? slug.replace(/-/g, " ");
  const { clean: name, nickname } = nicknameFrom(rawName);
  const imageUrl = str(person, "image");

  // Record: hero widget first, then the "Wins-loses-Draws" stat row.
  let record = parseHeroRecord($);
  const stats = readStats($);
  if (!record) {
    const recRow = stats.get("wins-loses-draws") ?? stats.get("wins-losses-draws");
    if (recRow) {
      const nums = recRow
        .find("p")
        .toArray()
        .filter((p) => !($(p).attr("class") ?? "").includes("w-condition-invisible"))
        .map((p) => clean($(p).text()) ?? "")
        .filter((t) => /^\d+$/.test(t));
      record = parseRecord(nums);
    }
  }

  const division = clean(stats.get("division")?.find("p").last().text() ?? null);
  const reachCm = parseLengthCm(stats.get("reach")?.find("p").last().text() ?? null);
  const heightCm = parseLengthCm(
    stats.get("height")?.find("[data-height]").first().attr("data-height") ??
      stats.get("height")?.find("p").last().text() ??
      null,
  );
  const stance = parseStance(stats.get("stance")?.find("p").last().text() ?? null);
  const nationality = clean(stats.get("nationality")?.find("p").last().text() ?? null);

  // Socials: any recognised platform link in the profile.
  const socials: BkfcSocial[] = [];
  const seen = new Set<string>();
  $('a[href^="http"]').each((_, a) => {
    const href = $(a).attr("href");
    const platform = socialPlatform(href);
    if (!platform || !href) return;
    if (seen.has(platform)) return;
    seen.add(platform);
    socials.push({ platform, url: href });
  });

  return {
    slug,
    url,
    name,
    nickname,
    imageUrl,
    record,
    division,
    heightCm,
    reachCm,
    stance,
    nationality,
    socials,
  };
}
