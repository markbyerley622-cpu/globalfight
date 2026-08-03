import * as cheerio from "cheerio";
import type { Element } from "domhandler";
import type { RankingConnector, RankingEntry } from "../connector";
import { normalizeWeightClass } from "../connector";
import { BOT_HEADERS } from "@/lib/http-identity";

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
//  (division name, rank, fighter name), never presentation. The pound-for-pound
//  grouping is ingested too, flagged isPoundForPound so it is stored as a P4P
//  list rather than a weight class. parse is a PURE function for fixture testing.
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

    // Pound-for-pound is a REAL grouping on this page and is now ingested as
    // one. It used to be skipped ("P4P stays engine/curated-driven"), which
    // left the product with no promotion P4P at all: the rating engine's output
    // is excluded from every public read, and the curated lists deliberately
    // exclude MMA. So the sport with the most-cited P4P list in combat sports
    // showed an empty P4P page while the official list sat un-parsed.
    const isP4P = /pound-for-pound/i.test(header);

    const female = /women/i.test(header);
    const gender = female ? "female" : "male";
    const base = header.replace(/women'?s/i, "").replace(/division|top rank/i, "").trim();
    if (!base) return;
    // Women's divisions keep the prefix so they never collide with the men's.
    const weightClass = isP4P
      ? (female ? "Women's " : "") + "Pound-for-Pound"
      : (female ? "Women's " : "") + normalizeWeightClass(base);

    const key = `${gender}|${weightClass}`;
    if (seenDivisions.has(key)) return; // UFC renders each division twice
    seenDivisions.add(key);

    // Champion → rank 0 (ingest keeps contenders; champions are a documented
    // follow-up to the Champion table, but we surface them for that work).
    const champ = nameOf($, $(g).find(".rankings--athlete--champion, .views-field-field-champion, .info").first().get(0) as Element);
    // A P4P grouping has no champion — only the divisions do.
    if (!isP4P && champ && !isChampionOrNoise(champ)) {
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
        name, weightClass, rank, gender, kind: "professional", isPoundForPound: isP4P,
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
  // The MIN_DIVISIONS floor counts WEIGHT-CLASS divisions only. P4P is excluded
  // from the count deliberately: it is a division-shaped grouping, so counting
  // it would let a page that rendered nothing but P4P clear a floor that exists
  // to prove the weight-class tables parsed.
  const divisions = new Set(entries.filter((e) => !e.isPoundForPound).map((e) => `${e.gender}|${e.weightClass}`));
  if (divisions.size < MIN_DIVISIONS) {
    throw new Error(`UFC parse produced only ${divisions.size} divisions (< ${MIN_DIVISIONS}) — refusing to publish a partial ranking`);
  }
  // Per-group sanity runs over EVERY grouping including P4P — the floor above
  // excludes P4P from counting, but a malformed P4P table must still refuse.
  const groups = new Set(entries.map((e) => `${e.gender}|${e.weightClass}`));
  for (const div of groups) {
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
  licensed: true, // registry (sources.ts) remains the source of truth for this
  async fetch(): Promise<RankingEntry[]> {
    const res = await fetch(SOURCE_URL, {
      // BOT_HEADERS, not a local string. This connector hardcoded its own
      // User-Agent naming globalfight.onrender.com — a host that answers 503 —
      // so it advertised a dead contact address from outside the one-identity
      // policy in lib/http-identity that exists to prevent exactly that drift.
      headers: { ...BOT_HEADERS },
      signal: AbortSignal.timeout(25_000),
    });
    if (!res.ok) throw new Error(`UFC fetch ${res.status}`);
    const entries = parseUfcRankings(await res.text());
    validateUfcRankings(entries); // never publish a partial/broken ranking
    return entries;
  },
};
