import * as cheerio from "cheerio";
import type { Element } from "domhandler";
import type { RankingConnector, RankingEntry } from "../connector";
import { normalizeWeightClass } from "../connector";

// ════════════════════════════════════════════════════════════════════════
//  MMA ranking connector — UFC.com official rankings (first provider).
//
//  Deliberately provider-shaped, not UFC-shaped: it implements RankingConnector
//  and returns the same normalized RankingEntry[] every other source does, so
//  adding PFL / ONE / Sherdog later is another module, not an engine change.
//
//  UFC.com is server-rendered (Drupal). Each division is a `.view-grouping` with
//  a header, a champion, and 15 ranked rows — and the page renders every division
//  TWICE, so we de-duplicate by (gender, division). We parse SEMANTIC content
//  (division name, rank, fighter name), never presentation. Pound-for-pound
//  groups are skipped in v1 (MMA P4P stays engine/curated-driven); this connector
//  owns the weight-class divisions. parse is a PURE function for fixture testing.
// ════════════════════════════════════════════════════════════════════════

const SOURCE_URL = "https://www.ufc.com/rankings";

/** Minimum divisions we expect from a healthy UFC page (8 men's + 3 women's). */
const MIN_DIVISIONS = 10;

const isChampionOrNoise = (name: string) =>
  !name || /^(champion|interim|vacant|—|-)$/i.test(name.trim());

/** Pull the fighter name from a UFC ranking row or champion block. */
function nameOf($: cheerio.CheerioAPI, el: Element): string {
  return $(el).find(".views-field-title a, .c-listing-athlete__name, h5 a, a").first().text().trim().replace(/\s+/g, " ");
}

/**
 * Parse UFC.com rankings HTML into normalized division entries. Pure — no I/O.
 * `now` is injected for deterministic tests. Throws on a clearly-broken page
 * (too few divisions) so a bad fetch never publishes a partial ranking.
 */
export function parseUfcRankings(html: string, now: Date = new Date()): RankingEntry[] {
  const $ = cheerio.load(html);
  const effectiveDate = now.toISOString().slice(0, 10);
  const entries: RankingEntry[] = [];
  const seenDivisions = new Set<string>();

  $(".view-grouping").each((_, g) => {
    const header = $(g).find(".view-grouping-header").first().text().trim().replace(/\s+/g, " ");
    if (!header) return;
    // v1 owns weight-class divisions; P4P stays engine/curated-driven.
    if (/pound-for-pound/i.test(header)) return;

    const female = /women/i.test(header);
    const gender = female ? "female" : "male";
    const base = header.replace(/women'?s/i, "").replace(/division|top rank/i, "").trim();
    if (!base) return;
    // Women's divisions keep the prefix so they never collide with the men's.
    const weightClass = (female ? "Women's " : "") + normalizeWeightClass(base);

    const key = `${gender}|${weightClass}`;
    if (seenDivisions.has(key)) return; // UFC renders each division twice
    seenDivisions.add(key);

    // Champion → rank 0 (ingest keeps contenders; champions are a documented
    // follow-up to the Champion table, but we surface them for that work).
    const champ = nameOf($, $(g).find(".rankings--athlete--champion, .views-field-field-champion, .info").first().get(0) as Element);
    if (champ && !isChampionOrNoise(champ)) {
      entries.push({
        name: champ, weightClass, rank: 0, gender, kind: "professional",
        countryCode: null, organisation: "UFC", sport: "mma", effectiveDate, sourceUrl: SOURCE_URL,
      });
    }

    $(g).find("tbody tr").each((__, tr) => {
      const cells = $(tr).find("td").map((___, c) => $(c).text().trim().replace(/\s+/g, " ")).get();
      const rank = Number.parseInt($(tr).find(".views-field-weight-class-rank").text().trim() || cells[0] || "", 10);
      if (!Number.isFinite(rank) || rank < 1) return;
      const name = nameOf($, tr);
      if (isChampionOrNoise(name)) return;
      entries.push({
        name, weightClass, rank, gender, kind: "professional",
        countryCode: null, organisation: "UFC", sport: "mma", effectiveDate, sourceUrl: SOURCE_URL,
      });
    });
  });

  return entries;
}

/**
 * Validation phase — kept separate from parsing so both are independently
 * testable. Throws on a clearly-broken page so a bad fetch NEVER publishes a
 * partial ranking (the runner records the failure and moves on).
 */
export function validateUfcRankings(entries: RankingEntry[]): void {
  const divisions = new Set(entries.map((e) => `${e.gender}|${e.weightClass}`));
  if (divisions.size < MIN_DIVISIONS) {
    throw new Error(`UFC parse produced only ${divisions.size} divisions (< ${MIN_DIVISIONS}) — refusing to publish a partial ranking`);
  }
  for (const div of divisions) {
    const ranks = entries.filter((e) => `${e.gender}|${e.weightClass}` === div && e.rank >= 1).map((e) => e.rank);
    // A near-empty division signals a broken parse (real ones list ~15).
    if (ranks.length < 5) {
      throw new Error(`UFC parse: division ${div} has only ${ranks.length} contenders — refusing to publish`);
    }
    // Ties are legitimate (UFC does rank two fighters equal), so a 2-way tie is
    // fine; the SAME rank appearing 3+ times is parse drift, not a tie.
    const counts = new Map<number, number>();
    for (const r of ranks) counts.set(r, (counts.get(r) ?? 0) + 1);
    for (const [rank, n] of counts) {
      if (n >= 3) throw new Error(`UFC parse: rank ${rank} appears ${n}× in ${div} — refusing to publish`);
    }
  }
}

export const ufcMmaConnector: RankingConnector = {
  id: "ufc-mma",
  label: "UFC.com Official Rankings (MMA)",
  trust: "official",
  licensed: false, // owner-controlled; registry flag is the source of truth
  async fetch(): Promise<RankingEntry[]> {
    const res = await fetch(SOURCE_URL, {
      headers: { "user-agent": "GlobalFightBot/1.0 (+https://globalfight.onrender.com)" },
      signal: AbortSignal.timeout(25_000),
    });
    if (!res.ok) throw new Error(`UFC fetch ${res.status}`);
    const entries = parseUfcRankings(await res.text());
    validateUfcRankings(entries); // never publish a partial/broken ranking
    return entries;
  },
};
