import { test } from "node:test";
import assert from "node:assert/strict";
import {
  parseWikipediaBoxingChampions,
  validateWikipediaBoxingChampions,
} from "../wikipedia-boxing";
import type { RankingEntry } from "../../connector";

// ════════════════════════════════════════════════════════════════════════════
//  Fixtures reproduce the REAL shape of the rendered Wikipedia page, captured
//  2026-08-07 from "List of current world boxing champions":
//    · section headings are `<div class="mw-heading mw-heading3">`, never a
//      bare <h3> — the parse API wraps them,
//    · a champion cell is `<a>name</a><br><span>qualifier</span><br>record<br>date`
//      with NO whitespace between the parts, and
//    · the table uses `rowspan` and never `colspan`.
//  Get any of those wrong and the parser reads plausible, wrong champions.
// ════════════════════════════════════════════════════════════════════════════

const HEADER = `<tr><th>WBA</th><th>WBC</th><th>IBF</th><th>WBO</th><th>The Ring</th></tr>`;

/** A champion cell exactly as Wikipedia renders it. */
function cell(
  name: string,
  opts: { qualifier?: string; record?: string; date?: string; rowspan?: number } = {},
): string {
  const rs = opts.rowspan && opts.rowspan > 1 ? ` rowspan="${opts.rowspan}"` : "";
  const qual = opts.qualifier ? `<br><span style="font-size: 85%;">${opts.qualifier}</span>` : "";
  const rec = opts.record ?? "25–1 (12 KO)";
  const date = opts.date ?? "February 22, 2025";
  return `<td${rs}><a href="/wiki/${name.replace(/ /g, "_")}" title="${name}">${name}</a>${qual}<br>${rec}<br>${date}</td>`;
}

const vacant = (rowspan?: number) =>
  `<td${rowspan && rowspan > 1 ? ` rowspan="${rowspan}"` : ""}>vacant\n</td>`;

function division(heading: string, rows: string[]): string {
  return `<div class="mw-heading mw-heading3"><h3>${heading}</h3><span class="mw-editsection">[edit]</span></div>
    <table class="wikitable">${HEADER}${rows.map((r) => `<tr>${r}</tr>`).join("")}</table>`;
}

const at = new Date("2026-08-07T00:00:00Z");
const parse = (html: string, gender: "male" | "female" = "male") =>
  parseWikipediaBoxingChampions(html, { gender, pageTitle: "List of current world boxing champions", now: at });

const find = (rows: RankingEntry[], org: string, weightClass?: string) =>
  rows.filter((r) => r.organisation === org && (!weightClass || r.weightClass === weightClass));

// ── 1. THE bug this parser exists to not have ───────────────────────────────

test("a rowspan-shifted row assigns interim titles to the RIGHT sanctioning body", () => {
  // Light heavyweight, transcribed from the live page 2026-08-07. The last row
  // contains only TWO cells because WBC, IBF and The Ring are still covered by
  // rowspans from row 1, and the WBO's span has just expired. Indexing cells by
  // their position inside their own <tr> puts the second one in the WBC column.
  // It belongs to the WBO — a wrong answer that looks entirely plausible,
  // because Callum Smith is a real light heavyweight and the division is right.
  const html = division("Light heavyweight (175 lb/79.4 kg)", [
    [
      cell("Dmitry Bivol", { qualifier: "Super champion" }),
      cell("David Benavidez", { rowspan: 3 }),
      cell("Dmitry Bivol", { rowspan: 3 }),
      cell("Dmitry Bivol", { rowspan: 2 }),
      cell("Dmitry Bivol", { rowspan: 3 }),
    ].join(""),
    cell("David Benavidez", { qualifier: "Regular champion" }),
    [
      cell("Albert Ramírez", { qualifier: "Interim champion" }),
      cell("Callum Smith", { qualifier: "Interim champion" }),
    ].join(""),
  ]);

  const rows = parse(html);
  const interim = rows.filter((r) => r.titleStatus === "INTERIM");

  assert.deepEqual(
    interim.map((r) => [r.organisation, r.name]).sort(),
    [["WBA", "Albert Ramírez"], ["WBO", "Callum Smith"]],
    "the second cell of a rowspan-shifted row belongs to the WBO, not the WBC",
  );
  // And the body that WAS spanning keeps its own champion, unduplicated.
  assert.deepEqual(find(rows, "WBC").map((r) => [r.name, r.titleStatus]), [["David Benavidez", "CHAMPION"]]);
});

test("a spanning cell is emitted ONCE, not once per row it covers", () => {
  const html = division("Cruiserweight (200 lb/90.7 kg)", [
    [cell("David Benavidez", { rowspan: 2 }), cell("Noel Mikaelian"), vacant(2), cell("David Benavidez", { rowspan: 2 }), cell("Jai Opetaia", { rowspan: 2 })].join(""),
    cell("Michał Cieślak", { qualifier: "Interim champion" }),
  ]);

  const rows = parse(html);
  assert.equal(find(rows, "WBA").length, 1, "a rowspan=2 champion must not be counted twice");
  assert.deepEqual(find(rows, "WBC").map((r) => [r.name, r.titleStatus]), [
    ["Noel Mikaelian", "CHAMPION"],
    ["Michał Cieślak", "INTERIM"],
  ]);
});

// ── 2. The cell has no whitespace in it ─────────────────────────────────────

test("the name is read from the link, so the record and date never leak into it", () => {
  // `.text()` on this cell yields "Dmitry Bivol25–1 (12 KO)February 22, 2025" as
  // one unbroken run. A name-shaped substring of that would create a junk
  // fighter on first ingest and never match the real one.
  const html = division("Light heavyweight (175 lb/79.4 kg)", [
    cell("Dmitry Bivol", { record: "25–1 (12 KO)", date: "February 22, 2025" }) + vacant() + vacant() + vacant() + vacant(),
  ]);
  const [row] = parse(html);
  assert.equal(row.name, "Dmitry Bivol");
});

test("effectiveDate is the PUBLICATION date — a long reign is not stale evidence", () => {
  // The regression that cost 65 belts. effectiveDate carried the date the title
  // was WON, which reads as the more truthful choice and is not what the field
  // means: `reconcile` filters on it with MAX_AGE_DAYS = 120, so every champion
  // who won more than four months ago was discarded as stale and no reign was
  // ever opened. Every WBC, WBO, IBF and Ring title was affected.
  //
  // Usyk won the Ring heavyweight belt in 2022. That is a fact about the reign,
  // not a claim that Wikipedia last spoke in 2022.
  const html = division("Heavyweight (+200 lb)", [
    cell("Oleksandr Usyk", { date: "August 20, 2022" }) + vacant() + vacant() + vacant() + vacant(),
  ]);
  const [row] = parse(html);

  assert.equal(row.effectiveDate, "2026-08-07", "the page was read today, whatever the belt's history");

  const ageDays = (at.getTime() - new Date(row.effectiveDate).getTime()) / 86_400_000;
  assert.ok(ageDays < 120, `evidence must be inside the reconciler's ${120}-day window, was ${ageDays}d`);
});

// ── 3. Vacancy and secondary belts ──────────────────────────────────────────

test("a vacant belt is reported as VACANT and names nobody", () => {
  const html = division("Middleweight (160 lb/72.6 kg)", [
    cell("Erislandy Lara") + cell("Carlos Adames") + vacant() + cell("Denzel Bentley") + vacant(),
  ]);
  const rows = parse(html);
  const vacancies = rows.filter((r) => r.titleStatus === "VACANT");

  assert.deepEqual(vacancies.map((r) => r.organisation).sort(), ["IBF", "The Ring"]);
  // The name must be empty. `resolveFighterFor` CREATES what it cannot find, so
  // any placeholder here ("vacant", "TBD") becomes a fighter in the registry and
  // then gets crowned champion of the division.
  assert.ok(vacancies.every((r) => r.name === ""), "a vacant belt must not carry a name");
});

test("a WBA regular champion behind a super champion is not published as a second champion", () => {
  // One division cannot have two WBA champions. The super champion is listed
  // first and is the one the belt is projected from; the regular titlist has no
  // status in the champion vocabulary and is dropped rather than guessed at.
  const html = division("Light heavyweight (175 lb/79.4 kg)", [
    [cell("Dmitry Bivol", { qualifier: "Super champion" }), vacant(2), vacant(2), vacant(2), vacant(2)].join(""),
    cell("David Benavidez", { qualifier: "Regular champion" }),
  ]);
  const wba = find(parse(html), "WBA");
  assert.deepEqual(wba.map((r) => [r.name, r.titleStatus]), [["Dmitry Bivol", "CHAMPION"]]);
});

test("two unqualified champions for one body yield one champion, not two", () => {
  const html = division("Featherweight (126 lb)", [
    [cell("First Listed"), vacant(2), vacant(2), vacant(2), vacant(2)].join(""),
    cell("Second Listed"),
  ]);
  assert.deepEqual(find(parse(html), "WBA").map((r) => r.name), ["First Listed"]);
});

// ── 4. Headings ─────────────────────────────────────────────────────────────

test("the division comes from the mw-heading wrapper, with the weight stripped", () => {
  // `prevAll("h3")` finds nothing in this HTML — the heading is wrapped in a
  // div. Every table would inherit one label, or none.
  const html = division("Super welterweight / Junior middleweight (154 lb / 69.9 kg)", [
    cell("Jaron Ennis") + vacant() + vacant() + vacant() + vacant(),
  ]);
  const [row] = parse(html);
  assert.equal(row.weightClass, "Super Welterweight", "the parenthetical weight and the second name are not part of the division");
});

test("each table takes its OWN heading, not the first one on the page", () => {
  const html =
    division("Heavyweight (+200 lb)", [cell("Murat Gassiev") + vacant() + vacant() + vacant() + vacant()]) +
    division("Bantamweight (118 lb)", [cell("Someone Small") + vacant() + vacant() + vacant() + vacant()]);
  const rows = parse(html).filter((r) => r.titleStatus === "CHAMPION");
  assert.deepEqual(rows.map((r) => [r.weightClass, r.name]), [
    ["Heavyweight", "Murat Gassiev"],
    ["Bantamweight", "Someone Small"],
  ]);
});

// ── 5. Column identity + shape guards ───────────────────────────────────────

test("organisations are read from the header, so a reordered table cannot transpose champions", () => {
  const reordered = `<div class="mw-heading mw-heading3"><h3>Heavyweight (+200 lb)</h3></div>
    <table class="wikitable">
      <tr><th>IBF</th><th>WBA</th><th>WBC</th><th>WBO</th><th>The Ring</th></tr>
      <tr>${cell("IBF Man")}${cell("WBA Man")}${cell("WBC Man")}${cell("WBO Man")}${cell("Ring Man")}</tr>
    </table>`;
  const rows = parse(reordered);
  assert.equal(find(rows, "IBF")[0].name, "IBF Man");
  assert.equal(find(rows, "WBA")[0].name, "WBA Man");
});

test("a table that is not a title table is ignored", () => {
  const html =
    `<table class="wikitable"><tr><th>Key</th><th>Meaning</th></tr><tr><td>†</td><td>Retired</td></tr></table>` +
    division("Heavyweight (+200 lb)", [cell("Murat Gassiev") + vacant() + vacant() + vacant() + vacant()]);
  const rows = parse(html);
  assert.equal(rows.filter((r) => r.titleStatus === "CHAMPION").length, 1);
  assert.ok(rows.every((r) => r.weightClass === "Heavyweight"));
});

test("every emitted row is a titleholder — the connector never claims to publish contender ratings", () => {
  const html = division("Heavyweight (+200 lb)", [
    cell("Murat Gassiev") + cell("Agit Kabayel") + vacant() + cell("Daniel Dubois") + cell("Oleksandr Usyk"),
  ]);
  const rows = parse(html);
  assert.ok(rows.every((r) => r.rank === 0));
  assert.ok(rows.every((r) => r.sport === "boxing" && r.kind === "professional"));
  assert.ok(rows.every((r) => r.sourceUrl.startsWith("https://en.wikipedia.org/wiki/")), "every row carries provenance");
});

test("gender is carried through, so the women's page cannot land in the men's divisions", () => {
  const html = division("Heavyweight (+200 lb)", [cell("Claressa Shields") + vacant() + vacant() + vacant() + vacant()]);
  assert.ok(parse(html, "female").every((r) => r.gender === "female"));
});

test("a women's division is LABELLED as one, or it overwrites the men's title", () => {
  // `resolveWeightClass` keys on (sport, name) and WeightClass has no gender
  // column, so this label is the only thing separating the two ladders. Without
  // the prefix, an ingest of both pages put Claressa Shields in the men's IBF
  // heavyweight row and opened a VACANT women's reign on Naoya Inoue's division
  // — ten (division, body) pairs with two open reigns each. Measured, not feared.
  const html = division("Heavyweight (+200 lb)", [
    cell("Claressa Shields") + vacant() + cell("Claressa Shields") + vacant() + vacant(),
  ]);

  const women = parse(html, "female");
  assert.ok(
    women.every((r) => r.weightClass === "Women's Heavyweight"),
    `women's rows must be prefixed, got ${[...new Set(women.map((r) => r.weightClass))].join(", ")}`,
  );

  // The men's page is the unmarked case and must NOT gain a prefix.
  assert.ok(parse(html, "male").every((r) => r.weightClass === "Heavyweight"));

  // And the two can never collide on the same WeightClass row.
  const shared = new Set(parse(html, "male").map((r) => r.weightClass));
  assert.ok(women.every((r) => !shared.has(r.weightClass)));
});

// ── 6. Validation refuses a restructured page ───────────────────────────────

test("validation rejects a harvest that lost a sanctioning body", () => {
  // A ranking ingest creates fighters and can retire a champion, so a page whose
  // shape changed must fail loudly rather than write a plausible subset.
  const rows = parse(division("Heavyweight (+200 lb)", [cell("A") + cell("B") + cell("C") + cell("D") + cell("E")]));
  assert.throws(() => validateWikipediaBoxingChampions(rows), /only \d+ held titles/);

  const missingBody = Array.from({ length: 30 }, (_, i) => ({
    ...rows[0], name: `Boxer ${i}`, organisation: "WBA", weightClass: `Division ${i % 10}`,
  }));
  assert.throws(() => validateWikipediaBoxingChampions(missingBody), /no WBC rows/);
});

test("validation rejects a held title with no name", () => {
  const rows: RankingEntry[] = Array.from({ length: 30 }, (_, i) => ({
    name: `Boxer ${i}`, weightClass: `Division ${i % 10}`, rank: 0, gender: "male" as const,
    kind: "professional" as const, countryCode: null,
    organisation: ["WBA", "WBC", "IBF", "WBO"][i % 4], sport: "boxing",
    titleStatus: "CHAMPION" as const, effectiveDate: "2026-01-01", sourceUrl: "https://en.wikipedia.org/wiki/X",
  }));
  rows[0].name = "   ";
  assert.throws(() => validateWikipediaBoxingChampions(rows), /has no name/);
});
