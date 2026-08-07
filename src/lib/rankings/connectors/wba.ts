import * as cheerio from "cheerio";
import type { Element } from "domhandler";
import type { RankingConnector, RankingEntry } from "../connector";
import { normalizeWeightClass } from "../connector";
import { BOT_HEADERS } from "@/lib/http-identity";

// ════════════════════════════════════════════════════════════════════════
//  WBA (World Boxing Association) — female world ratings connector.
//
//  Tier 1, official sanctioning body. The page is server-rendered HTML: one
//  <span>DIVISION</span> header precedes each ratings <table>, and each row is
//  `rank · name · (country)`, with the champion in a separate table flagged
//  "WBA WORLD CHAMPION". The parser is a PURE function of the HTML so it can be
//  tested against a fixture with no network.
//
//  Provenance: every row carries the WBA organisation, the source URL and the
//  effective date. Identity resolution + persistence happen later in ingest.ts —
//  this file NEVER touches Prisma.
// ════════════════════════════════════════════════════════════════════════

// ── One parser, two ratings pages ───────────────────────────────────────────
// The WBA publishes men's and women's world ratings on the same site, in the
// same server-rendered shape: a <span>DIVISION</span> header followed by a
// ratings <table>. The parser below was written for the female page and is
// structurally general, so the men's connector is the same function with a
// different URL and gender rather than a second copy to keep in step.
//
// Boxing has no single champion per division — the WBA, WBC, WBO and IBF each
// sanction their own belt — so each body is its own source with its own
// `organisation`, and nothing here ever merges them.
//
// VERIFIED 2026-08-07 against the live pages. The men's URL was previously
// `/wba-rankings` (plural), which answers 404 — the connector could never have
// worked, and because it was never licensed nobody found out. It is `/wba-ranking`.
const PAGES = {
  female: "https://www.wbaboxing.com/wba-female-ranking",
  male: "https://www.wbaboxing.com/wba-ranking",
} as const;

// ── Division headers ────────────────────────────────────────────────────────
// Every division prints as "<NAME>WEIGHT" except the minimum family, which the
// WBA prints bare (`<span>MINIMUM</span>`, `<span>LIGHT MINIMUM</span>`). That
// exception is spelled out rather than making the suffix optional everywhere:
// a bare `<span>LIGHT</span>` anywhere on the page would otherwise be read as a
// division header and re-label every table that follows it.
//
// This is not cosmetic. An unmatched header does not skip its table — the table
// inherits the PREVIOUS division's label, so the men's page was folding
// Minimumweight into Light Flyweight and publishing a 30-man division.
const DIVISIONS =
  "minimum|light minimum|light fly|fly|super fly|bantam|super bantam|feather|super feather|" +
  "light|super light|welter|super welter|middle|super middle|light heavy|cruiser|bridger|heavy";
const WEIGHT_RE = new RegExp(`^(?:(?:${DIVISIONS})weight|light minimum|minimum)$`, "i");

// Common ISO alpha-3 → alpha-2 (the WBA prints 3-letter codes). Unknown → null;
// identity resolution doesn't depend on this, it's display metadata only.
const A3_TO_A2: Record<string, string> = {
  USA: "US", MEX: "MX", GBR: "GB", CAN: "CA", COL: "CO", ARG: "AR", BRA: "BR",
  JPN: "JP", KOR: "KR", CHN: "CN", THA: "TH", PHI: "PH", VEN: "VE", PUR: "PR",
  DOM: "DO", FRA: "FR", GER: "DE", ESP: "ES", ITA: "IT", RUS: "RU", UKR: "UA",
  AUS: "AU", NZL: "NZ", IRL: "IE", RSA: "ZA", NGR: "NG", GHA: "GH", KAZ: "KZ",
  UZB: "UZ", IND: "IN", PAK: "PK", CUB: "CU", PAN: "PA", NIC: "NI", CRC: "CR",
  ECU: "EC", PER: "PE", CHI: "CL", URU: "UY", BEL: "BE", NED: "NL", SWE: "SE",
  NOR: "NO", FIN: "FI", DEN: "DK", POL: "PL", ROU: "RO", HUN: "HU", SRB: "RS",
  CRO: "HR", TUR: "TR", GEO: "GE", ARM: "AM", AZE: "AZ",
};

function toAlpha2(a3?: string | null): string | null {
  if (!a3) return null;
  const k = a3.trim().toUpperCase();
  return A3_TO_A2[k] ?? null;
}

/** A trailing 3-letter uppercase token is a country code; split it off the name. */
function splitNameCountry(raw: string): { name: string; country: string | null } {
  // Strip the page's footnote markers first, wherever they sit — they appear
  // BEFORE the country code as often as at the end ("IVANA HABAZIN * CRO"), so
  // an end-anchored strip misses them. "IVANA HABAZIN *" and "IVANA HABAZIN"
  // are one boxer, and identity resolution keys on the name, so leaving the
  // marker on manufactures a second registry entry for her.
  const cleaned = raw
    .replace(/\(\*+\)/g, " ")
    .replace(/(?:^|\s)\*+(?=\s|$)/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const m = cleaned.match(/^(.*?)[\s,]+([A-Z]{3})$/);
  if (m && m[1].length > 1) return { name: m[1].trim(), country: m[2] };
  return { name: cleaned, country: null };
}

// The men's page carries a BELT-ANNOTATION column between the name and the
// country — GOLD, INT, CON, C/NA, C/USA, BALTIC, NABA… (the page's own
// REFERENCES table at the foot enumerates them). They are regional/secondary
// belts held by the fighter, not part of their name.
const ANNOTATION_RE =
  /^(?:c|gold|int|con|lac|naba|panaf|wbao|baltic|c\/[a-z]{1,4}|(?:c|gold|int|con|baltic)(?:\s+(?:c|gold|int|con|baltic))+)$/i;

const isNoise = (name: string) =>
  !name || /^(not rated|vacant|n\/a|-|—|tbd)$/i.test(name.trim()) || ANNOTATION_RE.test(name.trim());

// ── The REFERENCES legend at the foot of the page ───────────────────────────
// It expands the annotation codes — `LAC: | WBA LATIN AMERICAN CHAMPION`. Every
// one of those rows contains the word CHAMPION, so the champion branch below
// read them as titleholders and the men's page yielded six extra "champions"
// named "LAC:", "NABA:", "PANAF:", "INTER:", "INT. CHAMP:" and "(**)".
//
// They would have been created as Fighter rows and opened TitleReigns. Two
// independent guards, because this is the failure that reaches the product as a
// visibly fake champion: skip the legend table wholesale, and reject a
// legend-shaped cell anywhere it appears.
const isLegendTable = (firstRow: string[]) =>
  firstRow.length <= 2 && /^references$/i.test((firstRow[0] ?? "").trim());

const isLegendKey = (cell: string) => /:$/.test(cell.trim()) || /^\(\*+\)$/.test(cell.trim());

/**
 * Parse WBA female ratings HTML into normalized entries. Pure — no I/O.
 * `now` is injected so tests are deterministic and the workflow sandbox (which
 * forbids Date.now) never reaches this indirectly.
 */
export function parseWba(
  html: string,
  gender: "male" | "female" = "female",
  now: Date = new Date(),
): RankingEntry[] {
  const $ = cheerio.load(html);
  const effectiveDate = now.toISOString().slice(0, 10);
  const sourceUrl = PAGES[gender];
  const entries: RankingEntry[] = [];
  let division: string | null = null;

  // ── The division label carries the gender ────────────────────────────────
  //
  // ingest resolves a WeightClass by (sport, name), so an unprefixed women's
  // division would land on the SAME WeightClass row the men's ratings use — and
  // this connector now feeds both. Two unrelated ladders in one division is the
  // "adding any men's source later would merge them" hazard, and it stopped
  // being hypothetical the moment the men's page was wired.
  //
  // Men's divisions keep the bare name (they are the unmarked case, exactly as
  // the sport writes them); women's are prefixed, which is also what the UFC
  // connector does. The gender is ALSO stored on its own column now — the label
  // is for humans and URLs, the column is what audits read.
  const label = (weightClass: string) =>
    gender === "male" || /^women'?s\b/i.test(weightClass) ? weightClass : `Women's ${weightClass}`;

  const parseTable = (el: Element, rawWeightClass: string) => {
    const weightClass = label(rawWeightClass);
    $(el).find("tr").each((_, tr) => {
      const cells = $(tr).find("td, th").map((__, c) => $(c).text().trim().replace(/\s+/g, " ")).get();
      if (cells.length === 0) return;
      const joined = cells.join(" ");

      // Champion table: a cell contains "CHAMPION"; the fighter is the cell before it.
      if (/champion/i.test(joined)) {
        const champCell = cells.find((c) => c && !/champion/i.test(c) && !/^wb[aco]$/i.test(c) && !isLegendKey(c));
        if (champCell) {
          const { name, country } = splitNameCountry(champCell);
          if (!isNoise(name)) {
            entries.push({
              name, weightClass, rank: 0, gender, kind: "professional",
              countryCode: toAlpha2(country), organisation: "WBA", sport: "boxing",
              effectiveDate, sourceUrl,
            });
          }
        }
        return;
      }

      // Contender row: leading integer rank, then name, optional trailing country.
      const rank = Number.parseInt(cells[0], 10);
      if (!Number.isFinite(rank) || rank < 1) return;
      const rest = cells.slice(1).filter(Boolean);
      if (rest.length === 0) return;
      const a3 = rest.length > 1 && /^[A-Z]{3}$/.test(rest[rest.length - 1]) ? rest[rest.length - 1] : null;
      // The NAME is its own cell — take it, never a join of everything before
      // the country. Joining swallowed the belt-annotation column on the men's
      // page and produced fighters called "FILIP HRGOVIC C GOLD", which then
      // resolve to nobody and get created as new registry entries.
      const rawName = rest[0];
      const { name, country } = splitNameCountry(rawName);
      if (isNoise(name)) return;
      entries.push({
        name, weightClass, rank, gender, kind: "professional",
        countryCode: toAlpha2(a3 ?? country), organisation: "WBA", sport: "boxing",
        effectiveDate, sourceUrl,
      });
    });
  };

  // DEPTH-FIRST, document order: a multi-selector .each() groups by selector
  // (all spans, then all tables), which would tag every table with the last
  // division. Walking the tree preserves the span→table adjacency the page uses.
  const walk = (node: Element) => {
    for (const child of ($(node).children().toArray() as Element[])) {
      const tag = child.tagName ?? child.name;
      if (tag === "span") {
        const txt = $(child).text().trim().replace(/\s+/g, " ");
        if (WEIGHT_RE.test(txt)) division = normalizeWeightClass(txt);
      } else if (tag === "table") {
        const firstRow = $(child).find("tr").first().find("td, th")
          .map((__, c) => $(c).text().trim().replace(/\s+/g, " ")).get();
        // The legend closes the ratings. Clearing the division stops it AND
        // anything after it from inheriting the last division's label — the
        // same inheritance that folded Minimumweight into Light Flyweight.
        if (isLegendTable(firstRow)) { division = null; continue; }
        if (division) parseTable(child, division);
      } else {
        walk(child);
      }
    }
  };
  walk($.root().toArray()[0] as unknown as Element);

  return entries;
}

/** Back-compat alias — the female parser by its original name. */
export const parseWbaFemale = (html: string, now?: Date) => parseWba(html, "female", now);

/**
 * Refuse a broken parse, the same way the UFC connector does.
 *
 * The WBA connector had NO validator, which was survivable while it read one
 * page whose shape was verified end-to-end. It is not survivable now: the men's
 * page is the same site but its markup has not been read by anyone here, and a
 * parser that silently returns four rows from a redesigned page would publish a
 * four-man world ranking as fact.
 *
 * So the men's connector is written to FAIL CLOSED. If the page differs, this
 * throws, the runner records the failure against the provider's checkpoint, and
 * nothing is published — which is the correct outcome for a source we have not
 * been able to verify by hand.
 */
export function validateWba(entries: RankingEntry[], minDivisions = 8): void {
  const divisions = new Set(entries.filter((e) => e.rank >= 1).map((e) => e.weightClass));
  if (divisions.size < minDivisions) {
    throw new Error(
      `WBA parse produced only ${divisions.size} divisions (< ${minDivisions}) — refusing to publish a partial ranking`,
    );
  }
  for (const division of divisions) {
    const ranks = entries.filter((e) => e.weightClass === division && e.rank >= 1).map((e) => e.rank);
    if (ranks.length < 5) {
      throw new Error(`WBA parse: ${division} has only ${ranks.length} contenders — refusing to publish`);
    }
    // A 2-way tie is legitimate; the same rank three or more times is drift.
    const counts = new Map<number, number>();
    for (const r of ranks) counts.set(r, (counts.get(r) ?? 0) + 1);
    for (const [rank, n] of counts) {
      if (n >= 3) throw new Error(`WBA parse: rank ${rank} appears ${n}× in ${division} — refusing to publish`);
    }
  }
}

function wbaConnector(gender: "male" | "female"): RankingConnector {
  return {
    id: `wba-${gender}`,
    label: `WBA ${gender === "male" ? "Men's" : "Female"} World Ratings`,
    trust: "official",
    // The registry (sources.ts) remains the source of truth for licensing; this
    // mirrors it so a connector cannot be run by being imported.
    licensed: true,
    async fetch(): Promise<RankingEntry[]> {
      const res = await fetch(PAGES[gender], {
        // BOT_HEADERS — see the identical note in connectors/ufc.ts.
        headers: { ...BOT_HEADERS },
        signal: AbortSignal.timeout(25_000),
      });
      if (!res.ok) throw new Error(`WBA ${gender} fetch ${res.status}`);
      const entries = parseWba(await res.text(), gender);
      validateWba(entries);
      return entries;
    },
  };
}

export const wbaFemaleConnector = wbaConnector("female");
export const wbaMaleConnector = wbaConnector("male");
