import * as cheerio from "cheerio";
import type { Element } from "domhandler";
import type { RankingConnector, RankingEntry } from "../connector";
import { normalizeWeightClass } from "../connector";

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

const SOURCE_URL = "https://www.wbaboxing.com/wba-female-ranking";

const WEIGHT_RE =
  /^(minimum|light fly|fly|super fly|bantam|super bantam|feather|super feather|light|super light|welter|super welter|middle|super middle|light heavy|cruiser|bridger|heavy)weight$/i;

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
  const cleaned = raw.replace(/\s+/g, " ").trim();
  const m = cleaned.match(/^(.*?)[\s,]+([A-Z]{3})$/);
  if (m && m[1].length > 1) return { name: m[1].trim(), country: m[2] };
  return { name: cleaned, country: null };
}

const isNoise = (name: string) =>
  !name || /^(not rated|vacant|n\/a|-|—|tbd)$/i.test(name.trim());

/**
 * Parse WBA female ratings HTML into normalized entries. Pure — no I/O.
 * `now` is injected so tests are deterministic and the workflow sandbox (which
 * forbids Date.now) never reaches this indirectly.
 */
export function parseWbaFemale(html: string, now: Date = new Date()): RankingEntry[] {
  const $ = cheerio.load(html);
  const effectiveDate = now.toISOString().slice(0, 10);
  const entries: RankingEntry[] = [];
  let division: string | null = null;

  const parseTable = (el: Element, weightClass: string) => {
    $(el).find("tr").each((_, tr) => {
      const cells = $(tr).find("td, th").map((__, c) => $(c).text().trim().replace(/\s+/g, " ")).get();
      if (cells.length === 0) return;
      const joined = cells.join(" ");

      // Champion table: a cell contains "CHAMPION"; the fighter is the cell before it.
      if (/champion/i.test(joined)) {
        const champCell = cells.find((c) => c && !/champion/i.test(c) && !/^wb[aco]$/i.test(c));
        if (champCell) {
          const { name, country } = splitNameCountry(champCell);
          if (!isNoise(name)) {
            entries.push({
              name, weightClass, rank: 0, gender: "female", kind: "professional",
              countryCode: toAlpha2(country), organisation: "WBA", sport: "boxing",
              effectiveDate, sourceUrl: SOURCE_URL,
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
      const rawName = a3 ? rest.slice(0, -1).join(" ") : rest[0];
      const { name, country } = splitNameCountry(rawName);
      if (isNoise(name)) return;
      entries.push({
        name, weightClass, rank, gender: "female", kind: "professional",
        countryCode: toAlpha2(a3 ?? country), organisation: "WBA", sport: "boxing",
        effectiveDate, sourceUrl: SOURCE_URL,
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
        if (division) parseTable(child, division);
      } else {
        walk(child);
      }
    }
  };
  walk($.root().toArray()[0] as unknown as Element);

  return entries;
}

export const wbaFemaleConnector: RankingConnector = {
  id: "wba-female",
  label: "WBA Female World Ratings",
  trust: "official",
  licensed: false, // owner-controlled; the registry's flag is the source of truth
  async fetch(): Promise<RankingEntry[]> {
    const res = await fetch(SOURCE_URL, {
      headers: { "user-agent": "GlobalFightBot/1.0 (+https://globalfight.onrender.com)" },
      signal: AbortSignal.timeout(25_000),
    });
    if (!res.ok) throw new Error(`WBA fetch ${res.status}`);
    return parseWbaFemale(await res.text());
  },
};
