import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { splitYearPage } from "../year-split";
import { parseWikiCard } from "../../wikicard/extract";

// Real captured Wikipedia markup. NO NETWORK.
//
// These pages are the reason ONE has 382 empty cards and kickboxing has zero
// events: the promotion never gets a per-card article, so wikicard's verifier
// rejects the year page (correctly) and promotion-index's shared-article guard
// refuses all 140 rows pointing at it (also correctly). The splitter is the
// missing capability, not a loosening of either guard — these tests pin that it
// sections the page rather than trusting it wholesale.

const fixture = (n: string) =>
  fs.readFileSync(path.join(import.meta.dirname, "fixtures", `${n}.html`), "utf8");

const GLORY = fixture("glory-2025");
const ONE_2019 = fixture("one-2019");
const ONE_2026 = fixture("one-2026");

// ── sectioning ──────────────────────────────────────────────────────────────

test("a year round-up is split into one section per card, each with its own bouts", () => {
  const { sections, report } = splitYearPage(GLORY);
  assert.equal(sections.length, 9);
  assert.equal(report.skipped.length, 0);

  // Every section carries an identity AND a card — a section with no bouts would
  // be the empty-card problem this exists to solve.
  for (const s of sections) {
    assert.ok(s.name, "section has a name");
    assert.ok(s.date, `${s.name} has a date`);
    assert.ok(parseWikiCard(s.cardHtml).length > 0, `${s.name} has bouts`);
  }
});

test("bouts land on the card they were actually fought on, not pooled across the year", () => {
  const { sections } = splitYearPage(GLORY);
  const g98 = sections.find((s) => s.name === "Glory 98");
  const g99 = sections.find((s) => s.name === "Glory 99");
  assert.ok(g98 && g99);

  const a = parseWikiCard(g98.cardHtml);
  const b = parseWikiCard(g99.cardHtml);
  assert.equal(a.length, 11);
  assert.equal(b.length, 16);

  // The failure this guards against: the old paths would have given BOTH events
  // the whole season. No fighter pair may appear on both cards.
  const pairs = (bs: typeof a) => new Set(bs.map((x) => `${x.redName}|${x.blueName}`));
  for (const p of pairs(a)) assert.ok(!pairs(b).has(p), `${p} claimed by two cards`);
});

test("the page's OWN infobox is not emitted as an event", () => {
  for (const [label, html] of [["glory", GLORY], ["one2019", ONE_2019], ["one2026", ONE_2026]] as const) {
    const { sections, report } = splitYearPage(html);
    const bad = /^\d{4} in /i;
    assert.ok(!sections.some((s) => bad.test(s.name)), `${label}: year page emitted as an event`);
    // And it is not a "skip" either — it was never a candidate.
    assert.ok(!report.skipped.some((s) => bad.test(s.name)), `${label}: year page counted as a miss`);
  }
});

test("a card whose bouts sit behind a bracket table is still found", () => {
  // Glory Collision 8 leads with a tournament bracket, so the results table is
  // not the very next table. Taking only the immediate next one lost this card.
  const { sections } = splitYearPage(GLORY);
  const collision = sections.find((s) => s.name.includes("Collision 8"));
  assert.ok(collision, "Collision 8 was dropped");
  assert.ok(parseWikiCard(collision.cardHtml).length > 0);
});

// ── the shape is stable, which is what makes one splitter enough ─────────────

test("the same splitter reads both promotions and both eras", () => {
  for (const [label, html, min] of [
    ["glory-2025", GLORY, 9],
    ["one-2019", ONE_2019, 6],
    ["one-2026", ONE_2026, 6],
  ] as const) {
    const { sections } = splitYearPage(html);
    assert.equal(sections.length, min, label);
    const bouts = sections.reduce((n, s) => n + parseWikiCard(s.cardHtml).length, 0);
    assert.ok(bouts > 50, `${label}: only ${bouts} bouts`);
  }
});

test("the infobox title and the table caption are kept apart", () => {
  // They disagree, and only one of them can be matched against our stored name:
  // infobox "ONE Championship: Eternal Glory" vs caption "ONE: Eternal Glory".
  const { sections } = splitYearPage(ONE_2019);
  const eg = sections.find((s) => s.name === "ONE Championship: Eternal Glory");
  assert.ok(eg);
  assert.equal(eg.caption, "ONE: Eternal Glory");

  // A caption that merely restates the name is dropped rather than stored twice.
  const plain = splitYearPage(GLORY).sections.find((s) => s.name === "Glory 98");
  assert.equal(plain?.caption, null);
});

test("a title split over two lines does not read back as one token", () => {
  // "Glory 108<br>RISE World Series 2026 Tokyo" came back as "Glory 108RISE World
  // Series 2026 Tokyo" — a name that matches nothing, on a card that looked fine.
  const { sections } = splitYearPage(
    `<div><table class="infobox"><tr><th>Glory 108<br>RISE World Series</th></tr>
       <tr><th>Promotion</th><td>Glory</td></tr><tr><th>Date</th><td>June 6, 2026</td></tr></table>
     <table class="wikitable"><tr><th>Weight Class</th><th>Method</th><th>Round</th></tr>
       <tr><td>Heavyweight</td><td>A def. B</td><td>KO</td></tr></table></div>`,
  );
  assert.equal(sections[0].name, "Glory 108 RISE World Series");
});

test("venue and date come off the infobox", () => {
  const { sections } = splitYearPage(GLORY);
  const g98 = sections.find((s) => s.name === "Glory 98");
  assert.equal(g98?.date?.slice(0, 10), "2025-02-22");
  assert.equal(g98?.venue, "RTM Stage");
});

// ── refusals ────────────────────────────────────────────────────────────────

test("a page with no infoboxes yields nothing rather than guessing", () => {
  const { sections, report } = splitYearPage(
    `<div><table class="wikitable"><tr><th>Weight Class</th><th>Method</th></tr>
     <tr><td>Flyweight</td><td>A def. B</td></tr></table></div>`,
  );
  assert.equal(sections.length, 0);
  assert.equal(report.skipped.length, 0);
});

test("an event whose card is missing is REPORTED, never emitted empty", () => {
  const { sections, report } = splitYearPage(
    `<div><table class="infobox"><tr><th>Glory 500</th></tr>
       <tr><th>Promotion</th><td>Glory</td></tr>
       <tr><th>Date</th><td>March 3, 2025</td></tr></table>
     <table class="wikitable"><tr><th>Award</th><th>Winner</th></tr></table></div>`,
  );
  assert.equal(sections.length, 0);
  assert.deepEqual(report.skipped, [{ name: "Glory 500", why: "no results table before the next event" }]);
});

test("a results table is never attached across an event boundary", () => {
  // Event A has no card; the next table belongs to event B. Attaching it to A
  // would write B's bouts onto A — the exact failure the guards were protecting.
  const { sections, report } = splitYearPage(
    `<div><table class="infobox"><tr><th>Glory 500</th></tr>
       <tr><th>Promotion</th><td>Glory</td></tr><tr><th>Date</th><td>March 3, 2025</td></tr></table>
     <table class="infobox"><tr><th>Glory 501</th></tr>
       <tr><th>Promotion</th><td>Glory</td></tr><tr><th>Date</th><td>April 4, 2025</td></tr></table>
     <table class="wikitable"><tr><th>Weight Class</th><th>Method</th><th>Round</th></tr>
       <tr><td>Heavyweight</td><td>A def. B</td><td>KO</td></tr></table></div>`,
  );
  assert.equal(sections.length, 1);
  assert.equal(sections[0].name, "Glory 501");
  assert.deepEqual(report.skipped, [{ name: "Glory 500", why: "no results table before the next event" }]);
});
