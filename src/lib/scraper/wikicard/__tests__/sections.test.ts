import { test } from "node:test";
import assert from "node:assert/strict";
import { indexSections, findEventWindow, headingScore, sectionHtml } from "../sections";
import { parseWikiCard } from "../extract";

// ════════════════════════════════════════════════════════════════════════════
//  Section windowing. The numbers these tests defend, measured against the live
//  "2025 in ONE Championship" (1.18 MB, 209 sections):
//
//    parsed whole    → 553 bouts   (the whole year on one card)
//    windowed to one → 12 bouts    (a real card)
//
//  So every test here is ultimately about one question: can a row from event A
//  ever reach event B? The answer has to be no, including when the answer to
//  "which section is event B" is "don't know".
// ════════════════════════════════════════════════════════════════════════════

/** Wikipedia's parse output: a flat run of siblings, headings wrapped in divs. */
function article(...parts: string[]): string {
  return `<div class="mw-parser-output">${parts.join("")}</div>`;
}
const h = (level: number, text: string) =>
  `<div class="mw-heading mw-heading${level}"><h${level}>${text}</h${level}><span class="mw-editsection">[edit]</span></div>`;
const card = (rows: [string, string][]) =>
  `<table class="toccolours"><tbody>${rows
    .map(([r, b]) => `<tr><td>Bantamweight</td><td>${r}</td><td>def.</td><td>${b}</td><td>KO</td><td>2</td><td>1:30</td><td></td></tr>`)
    .join("")}</tbody></table>`;

const SEASON = article(
  h(2, "ONE Friday Fights 34"),
  card([["Alpha One", "Alpha Two"]]),
  h(2, "ONE Friday Fights 35"),
  h(3, "Background"),
  "<p>Some prose.</p>",
  h(3, "Results"),
  card([["Bravo One", "Bravo Two"], ["Bravo Three", "Bravo Four"]]),
  h(2, "ONE Friday Fights 36"),
  card([["Charlie One", "Charlie Two"]]),
);

// ── 1. The core property ────────────────────────────────────────────────────

test("a window contains its own event's bouts and no neighbour's", () => {
  const whole = parseWikiCard(SEASON);
  assert.equal(whole.length, 4, "the whole document really does carry every event's bouts");

  const r = findEventWindow(SEASON, "ONE Friday Fights 35");
  assert.ok(r.ok, "should find the section");
  const bouts = parseWikiCard(r.window.html);

  assert.deepEqual(bouts.map((b) => b.redName), ["Bravo One", "Bravo Three"]);
  assert.ok(!bouts.some((b) => b.redName.startsWith("Alpha")), "must not reach back into 34");
  assert.ok(!bouts.some((b) => b.redName.startsWith("Charlie")), "must not reach forward into 36");
});

test("a deeper subsection stays INSIDE its event's window", () => {
  // "Results" is an h3 under the h2 event heading. Ending the window at the next
  // heading of ANY level would cut the card off entirely — the bouts live in the
  // subsection, not beside it.
  const r = findEventWindow(SEASON, "ONE Friday Fights 35");
  assert.ok(r.ok);
  assert.equal(parseWikiCard(r.window.html).length, 2);
});

test("the first and last events are bounded correctly", () => {
  const first = findEventWindow(SEASON, "ONE Friday Fights 34");
  const last = findEventWindow(SEASON, "ONE Friday Fights 36");
  assert.ok(first.ok && last.ok);
  assert.deepEqual(parseWikiCard(first.window.html).map((b) => b.redName), ["Alpha One"]);
  assert.deepEqual(parseWikiCard(last.window.html).map((b) => b.redName), ["Charlie One"]);
});

// ── 2. The near-miss that decides whether cards land on the right event ─────

test("a shorter event number never matches a longer one", () => {
  // "ONE Friday Fights 3" against a page of 34/35/36. Any substring test says
  // yes to all three — "one friday fights 3" IS a prefix of
  // "one friday fights 35" — and the card lands on the wrong event while
  // looking perfectly healthy. Tokens are compared whole, so "3" ≠ "35".
  const r = findEventWindow(SEASON, "ONE Friday Fights 3");
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.reason, "NO_CONFIDENT_SECTION");
});

test("numbers must agree in both directions", () => {
  assert.equal(headingScore("ONE Friday Fights 3", "ONE Friday Fights 35"), 0);
  assert.equal(headingScore("ONE Friday Fights 35", "ONE Friday Fights 3"), 0);
  assert.ok(headingScore("ONE Friday Fights 35", "ONE Friday Fights 35") > 0.9);
});

// ── 3. Both sides carry extra words ────────────────────────────────────────

test("our longer stored name still matches Wikipedia's shorter heading", () => {
  // The DB carries broadcast branding Wikipedia does not:
  // "ONE Fight Night 33: Rodrigues Vs. Persson on Prime Video" vs the heading
  // "ONE Fight Night 33". Requiring the whole stored name to appear in the
  // heading refused a real, findable card over three words of marketing.
  const doc = article(h(2, "ONE Fight Night 33"), card([["Red Man", "Blue Man"]]));
  const r = findEventWindow(doc, "ONE Fight Night 33: Rodrigues Vs. Persson on Prime Video");
  assert.ok(r.ok, "heading contained in the event name is still an identification");
  assert.equal(parseWikiCard(r.window.html).length, 1);
});

test("a heading with a subtitle still matches our plain name", () => {
  const doc = article(h(2, "ONE Friday Fights 35: Superlek vs Takeru"), card([["Red Man", "Blue Man"]]));
  const r = findEventWindow(doc, "ONE Friday Fights 35");
  assert.ok(r.ok);
});

// ── 4. Refusing beats guessing ──────────────────────────────────────────────

test("an event absent from the article yields no window", () => {
  const r = findEventWindow(SEASON, "ONE Fight Night 99");
  assert.equal(r.ok, false);
});

test("a duplicated heading at the same depth is AMBIGUOUS, not a coin flip", () => {
  const doc = article(
    h(2, "ONE Friday Fights 40"), card([["First One", "First Two"]]),
    h(2, "ONE Friday Fights 40"), card([["Second One", "Second Two"]]),
  );
  const r = findEventWindow(doc, "ONE Friday Fights 40");
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.reason, "AMBIGUOUS_SECTION");
});

test("a same-name subsection does NOT make the event ambiguous", () => {
  // An h3 repeat under the h2 is the ordinary shape, and the h2 window already
  // contains it. Refusing here would throw away a perfectly good card.
  const doc = article(
    h(2, "ONE Friday Fights 41"),
    h(3, "ONE Friday Fights 41"),
    card([["Red Man", "Blue Man"]]),
  );
  const r = findEventWindow(doc, "ONE Friday Fights 41");
  assert.ok(r.ok, "the shallower heading wins");
  if (r.ok) assert.equal(r.window.section.level, 2);
});

test("an article with no headings yields no window", () => {
  const r = findEventWindow(`<div class="mw-parser-output">${card([["A One", "B One"]])}</div>`, "ONE 100");
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.reason, "NO_SECTIONS");
});

test("a one-token or generic name cannot select a section", () => {
  // "ONE" alone must not match "ONE Friday Fights 35" — a two-token minimum on
  // both sides is what stops a promotion name selecting an arbitrary event.
  assert.equal(headingScore("ONE", "ONE Friday Fights 35"), 0);
});

// ── 5. The index itself ─────────────────────────────────────────────────────

test("sections are indexed with correct levels and bounds", () => {
  const { sections } = indexSections(SEASON);
  const h2s = sections.filter((s) => s.level === 2).map((s) => s.heading);
  assert.deepEqual(h2s, ["ONE Friday Fights 34", "ONE Friday Fights 35", "ONE Friday Fights 36"]);

  const s35 = sections.find((s) => s.heading === "ONE Friday Fights 35")!;
  const s36 = sections.find((s) => s.heading === "ONE Friday Fights 36")!;
  assert.equal(s35.end, s36.start, "an event section ends exactly where the next begins");
  assert.ok(s35.end > s35.start + 1, "and is not empty");
});

test("a bare <h2> is indexed as well as the wrapped form", () => {
  // Older cached HTML emits bare heading tags. Matching only `div.mw-heading`
  // yields an article with zero sections, and "no window" then looks like an
  // honest miss rather than a parser that never looked.
  const doc = `<div class="mw-parser-output"><h2>ONE Friday Fights 50</h2>${card([["Red Man", "Blue Man"]])}</div>`;
  const r = findEventWindow(doc, "ONE Friday Fights 50");
  assert.ok(r.ok);
  assert.equal(parseWikiCard(r.window.html).length, 1);
});

test("the heading itself is excluded from the window", () => {
  const { $, nodes, sections } = indexSections(SEASON);
  const s = sections.find((x) => x.heading === "ONE Friday Fights 34")!;
  assert.ok(!sectionHtml($, nodes, s).includes("mw-editsection"));
});
