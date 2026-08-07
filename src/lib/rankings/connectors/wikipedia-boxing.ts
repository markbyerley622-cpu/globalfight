import * as cheerio from "cheerio";
import type { AnyNode, Element } from "domhandler";
import type { RankingConnector, RankingEntry, TitleStatus } from "../connector";
import { normalizeWeightClass } from "../connector";
import { fetchPageHtml } from "@/lib/scraper/wikicard/client";

// ════════════════════════════════════════════════════════════════════════════
//  Wikipedia — current world boxing champions (CC BY-SA), male + female.
//
//  WHY THIS SOURCE EXISTS. Boxing has four major sanctioning bodies and we could
//  read exactly one of them: the WBA. WBC, WBO and IBF are all
//  `licensed: false, connectorReady: false` in sources.ts, so three quarters of
//  every division's title picture was simply absent, and BoxRec — which has all
//  of it — is permanently blocklisted because its terms forbid bulk ingest.
//
//  Wikipedia publishes the same facts under CC BY-SA, and this codebase already
//  reads it for fight cards and results (lib/scraper/wikicard). One page carries
//  all five title lines per division, so this connector closes the WBC/WBO/IBF
//  gap without touching a source we are not allowed to touch.
//
//  WHAT IT EMITS. Titleholders only — rank 0. It does NOT emit contenders,
//  because Wikipedia does not publish the sanctioning bodies' contender ratings;
//  a division's top 15 still has to come from the body itself. Nothing here
//  competes with the WBA connector: the reconciler sees two observations of the
//  same WBA belt and tier decides, which is the design.
//
//  The parser is a PURE function of the HTML so it is tested against fixtures
//  with no network, and it NEVER touches Prisma.
// ════════════════════════════════════════════════════════════════════════════

const PAGES = {
  male: "List of current world boxing champions",
  female: "List of current female world boxing champions",
} as const;

/** Public URL for provenance — every emitted row carries the page it was read from. */
const urlFor = (title: string) => `https://en.wikipedia.org/wiki/${encodeURIComponent(title.replace(/ /g, "_"))}`;

/**
 * The five title lines the page tabulates, in column order.
 *
 * Matched against the header text rather than assumed by position: the column
 * order is stable today, but reading it from the header means a Wikipedia editor
 * reordering the table cannot silently transpose every champion in the database
 * onto the wrong sanctioning body.
 */
const ORGANISATIONS = ["WBA", "WBC", "IBF", "WBO", "The Ring"] as const;

const ORG_ALIASES: Record<string, string> = {
  wba: "WBA", wbc: "WBC", ibf: "IBF", wbo: "WBO",
  "the ring": "The Ring", ring: "The Ring",
};

/**
 * The qualifier Wikipedia prints under a name, mapped to the title status the
 * champion pipeline already understands (lib/rankings/champions).
 *
 * This distinction is the whole reason this connector needs `titleStatus`. An
 * interim titlist is NOT the division's champion — writing him as one would
 * displace the real champion in `Champion` and open a bogus `TitleReign`. The
 * status vocabulary existed; it was just unreachable from a connector.
 */
function statusForQualifier(qualifier: string): TitleStatus | "SECONDARY" {
  const q = qualifier.toLowerCase();
  if (q.includes("interim")) return "INTERIM";
  // "Super champion" is the WBA's primary belt; an unqualified cell is the
  // ordinary case for the other three bodies.
  if (q.includes("super") || q === "") return "CHAMPION";
  // A WBA "Regular champion" sitting BEHIND a super champion is a second belt in
  // the same division. We have no status that means that, and promoting him to
  // CHAMPION would make two men champion of one division. Marked and dropped by
  // the caller rather than guessed at — see `SECONDARY` handling in parse().
  if (q.includes("regular")) return "SECONDARY";
  if (q.includes("undisputed") || q.includes("lineal")) return "CHAMPION";
  return "CHAMPION";
}

/**
 * Expand a table into a dense grid, honouring `rowspan`.
 *
 * THE bug this file exists to not have. The page uses 54 rowspans and zero
 * colspans: when a body's champion cell spans two rows, the row beneath it
 * contains FEWER <td>s, and the remaining ones shift left. Indexing cells by
 * their position within their own <tr> therefore reads an interim WBC champion
 * out of the WBA column — a wrong answer that looks entirely plausible, because
 * the name is a real boxer and the division is right.
 *
 * Cells are placed into a fixed-width grid instead, with a spanning cell
 * occupying its column in every row it covers. Only the ORIGIN row of a
 * rowspan carries the value; the covered rows get null, because a champion
 * listed once must not be emitted twice.
 */
function toGrid($: cheerio.CheerioAPI, table: Element, width: number): (Element | null)[][] {
  const rows = $(table).find("tr").toArray();
  const grid: (Element | null)[][] = [];
  // How many more rows the cell occupying each column is still covering.
  const carry: number[] = new Array(width).fill(0);

  for (let r = 0; r < rows.length; r++) {
    const out: (Element | null)[] = new Array(width).fill(null);
    const cells = $(rows[r]).find("> td, > th").toArray();
    let col = 0;
    for (const cell of cells) {
      // Skip columns still covered by a rowspan started above.
      while (col < width && carry[col] > 0) {
        carry[col] -= 1;
        col += 1;
      }
      if (col >= width) break;
      out[col] = cell as Element;
      const span = Number($(cell).attr("rowspan") ?? 1);
      if (span > 1) carry[col] = span - 1;
      col += 1;
    }
    // Any trailing columns that were covered but had no cell in this row.
    while (col < width) {
      if (carry[col] > 0) carry[col] -= 1;
      col += 1;
    }
    grid.push(out);
  }
  return grid;
}

/**
 * The division a table belongs to, from the heading immediately above it.
 *
 * Wikipedia's parse output wraps section headings in `<div class="mw-heading">`
 * rather than emitting a bare `<h3>`, so `prevAll("h3")` finds nothing at all —
 * every table would inherit one division label, or none.
 */
function divisionFor($: cheerio.CheerioAPI, table: Element): string | null {
  const heading = $(table).prevAll("div.mw-heading, h2, h3, h4").first();
  if (!heading.length) return null;
  const raw = heading
    .text()
    .replace(/\[\s*edit\s*\]/gi, " ")
    // "Heavyweight (+200 lb/+90.7 kg or +224 lb/+101.6 kg)" — the weight is
    // documentation, not part of the division's name.
    .replace(/\([^)]*\)/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!raw) return null;
  // "Cruiserweight/Junior heavyweight" — one division under two names. Take the
  // first, which is the one the WeightClass table is keyed on.
  const primary = raw.split("/")[0].trim();
  return primary || null;
}

/**
 * Women's divisions carry the prefix; men's are the unmarked case.
 *
 * NOT cosmetic. `resolveWeightClass` keys on (sport, name) and WeightClass has
 * no gender column, so an unprefixed women's division lands on the SAME row the
 * men's title uses. Measured, before this existed: Claressa Shields was written
 * as IBF **Heavyweight** champion in the men's division, and a vacant women's
 * super-bantamweight belt opened a VACANT reign on the row holding Naoya Inoue.
 * Ten (division, body) pairs ended up with two open reigns.
 *
 * The WBA and UFC connectors already do exactly this — see the note in wba.ts.
 */
function genderedLabel(weightClass: string, gender: "male" | "female"): string {
  if (gender === "male") return weightClass;
  return /^women'?s\b/i.test(weightClass) ? weightClass : `Women's ${weightClass}`;
}

/** A parsed champion cell: who, and under what qualifier. */
interface CellClaim {
  name: string | null;
  qualifier: string;
  /** The date the source says the title was won, ISO, or null. */
  wonOn: string | null;
  vacant: boolean;
}

function readCell($: cheerio.CheerioAPI, cell: Element): CellClaim {
  const $cell = $(cell);
  const text = $cell.text().replace(/\s+/g, " ").trim();
  if (!text || /^vacant$/i.test(text)) {
    return { name: null, qualifier: "", wonOn: null, vacant: /^vacant$/i.test(text) };
  }

  // The name is the first wiki link. Reading it from the <a> rather than from the
  // cell's text is what keeps the record and the date out of the name — the cell
  // has no whitespace between them, so `.text()` yields
  // "Dmitry Bivol25–1 (12 KO)February 22, 2025" as one run.
  const link = $cell.find("a").first();
  const name = (link.text() || "").trim() || null;

  // The qualifier is the small-print span under the name.
  const qualifier = $cell
    .find("span")
    .map((_, s) => $(s).text().trim())
    .get()
    .find((t) => /champion|titlist/i.test(t)) ?? "";

  // A date at the END of the cell is when the belt was won.
  const dateMatch = text.match(/([A-Z][a-z]+ \d{1,2}, \d{4})\s*$/);
  const wonOn = dateMatch ? isoOrNull(dateMatch[1]) : null;

  return { name, qualifier, wonOn, vacant: false };
}

function isoOrNull(raw: string): string | null {
  const d = new Date(`${raw} UTC`);
  return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
}

/**
 * Parse a "current world champions" page into titleholder entries.
 *
 * Pure: no network, no Prisma. `now` supplies the fallback effective date for a
 * cell that publishes no date-won.
 */
export function parseWikipediaBoxingChampions(
  html: string,
  opts: { gender: "male" | "female"; pageTitle: string; now?: Date },
): RankingEntry[] {
  const $ = cheerio.load(html);
  const now = opts.now ?? new Date();
  const fallbackDate = now.toISOString().slice(0, 10);
  const sourceUrl = urlFor(opts.pageTitle);
  const entries: RankingEntry[] = [];

  $("table.wikitable").each((_, table) => {
    const headerCells = $(table).find("tr").first().find("th, td").toArray();
    const orgs = headerCells.map((c) => ORG_ALIASES[$(c).text().trim().toLowerCase()] ?? null);
    // Only a title table. The page carries other wikitables (explanatory keys,
    // summaries); a table whose header is not at least two sanctioning bodies is
    // not one of ours, and guessing costs a division of wrong champions.
    if (orgs.filter(Boolean).length < 2) return;

    const division = divisionFor($, table as Element);
    if (!division) return;
    const weightClass = genderedLabel(normalizeWeightClass(division), opts.gender);

    const grid = toGrid($, table as Element, orgs.length);
    // Track which (org) already has a primary champion in THIS division, so a
    // WBA "Regular champion" behind a "Super champion" is recognised as the
    // second belt it is rather than overwriting the first.
    const primaryTaken = new Set<string>();

    // Row 0 is the header.
    for (let r = 1; r < grid.length; r++) {
      for (let c = 0; c < orgs.length; c++) {
        const org = orgs[c];
        const cell = grid[r][c];
        if (!org || !cell) continue;

        const claim = readCell($, cell);
        if (claim.vacant) {
          entries.push({
            name: "", weightClass, rank: 0, gender: opts.gender, kind: "professional",
            countryCode: null, organisation: org, sport: "boxing",
            titleStatus: "VACANT",
            effectiveDate: fallbackDate, sourceUrl,
          });
          continue;
        }
        if (!claim.name) continue;

        let status = statusForQualifier(claim.qualifier);
        if (status === "CHAMPION") {
          // Two unqualified champions for one body in one division cannot both be
          // the champion. The first wins (the page lists super/undisputed first);
          // the rest are secondary belts.
          if (primaryTaken.has(org)) status = "SECONDARY";
          else primaryTaken.add(org);
        }
        // A secondary belt has no status in the champion vocabulary, and
        // inventing one would publish a second champion for the division. It is
        // dropped here deliberately — see the note on statusForQualifier.
        if (status === "SECONDARY") continue;

        entries.push({
          name: claim.name,
          weightClass,
          rank: 0,
          gender: opts.gender,
          kind: "professional",
          countryCode: null,
          organisation: org,
          sport: "boxing",
          titleStatus: status,
          // The date the belt was WON, not the date we fetched. That is what the
          // source actually asserts about this claim, and it is what makes the
          // ingest idempotent: the champion-observation key includes the
          // effective date, so re-reading an unchanged page writes nothing,
          // while a new champion carries a new date and is recorded.
          effectiveDate: claim.wonOn ?? fallbackDate,
          sourceUrl,
        });
      }
    }
  });

  return entries;
}

/**
 * Refuse a harvest that cannot be right, before it reaches the database.
 *
 * A ranking ingest creates fighters and can retire a champion, so a page that
 * Wikipedia restructured must fail loudly rather than write a plausible subset.
 */
export function validateWikipediaBoxingChampions(entries: RankingEntry[]): void {
  const held = entries.filter((e) => e.titleStatus !== "VACANT");
  if (held.length < 20) {
    throw new Error(`wikipedia-boxing: only ${held.length} held titles parsed — page shape changed`);
  }
  const divisions = new Set(entries.map((e) => e.weightClass));
  if (divisions.size < 8) {
    throw new Error(`wikipedia-boxing: only ${divisions.size} divisions parsed — heading match failed`);
  }
  const orgs = new Set(entries.map((e) => e.organisation));
  for (const required of ["WBA", "WBC", "IBF", "WBO"]) {
    if (!orgs.has(required)) throw new Error(`wikipedia-boxing: no ${required} rows — column match failed`);
  }
  // The whole point of the connector is titleholders; a contender row would mean
  // the parser wandered into a table it does not understand.
  if (entries.some((e) => e.rank !== 0)) {
    throw new Error("wikipedia-boxing: emitted a non-titleholder row");
  }
  for (const e of entries) {
    if (e.titleStatus !== "VACANT" && !e.name.trim()) {
      throw new Error(`wikipedia-boxing: a held ${e.organisation} ${e.weightClass} title has no name`);
    }
  }
}

async function fetchFor(gender: "male" | "female"): Promise<RankingEntry[]> {
  const pageTitle = PAGES[gender];
  const html = await fetchPageHtml(pageTitle);
  if (!html) throw new Error(`wikipedia-boxing: "${pageTitle}" could not be fetched`);
  const entries = parseWikipediaBoxingChampions(html, { gender, pageTitle });
  validateWikipediaBoxingChampions(entries);
  return entries;
}

// Trust: `media`, not `official`. Wikipedia is a secondary source — accurate and
// well-cited, but it is not the WBA publishing its own ratings. That gap is what
// makes the reconciler prefer the WBA's own connector for a WBA belt while still
// accepting Wikipedia as the only voice on WBC, WBO and IBF.
export const wikipediaBoxingMaleConnector: RankingConnector = {
  id: "wikipedia-boxing-male",
  label: "Wikipedia — Current World Boxing Champions (Men)",
  trust: "media",
  licensed: true,
  fetch: () => fetchFor("male"),
};

export const wikipediaBoxingFemaleConnector: RankingConnector = {
  id: "wikipedia-boxing-female",
  label: "Wikipedia — Current World Boxing Champions (Women)",
  trust: "media",
  licensed: true,
  fetch: () => fetchFor("female"),
};

export type { AnyNode };
