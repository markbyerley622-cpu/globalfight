import { test } from "node:test";
import assert from "node:assert/strict";
import { eventTitleBesideMark } from "@/lib/promotions";

// A UFC card read, top to bottom: the logo, then "UFC", then "UFC 322" — the
// organisation stated three times before anything distinguished this card from
// the other 321. The adjacent text is handled in PromotionLogo; this is the
// title, and it applies ONLY where a real brand mark renders beside it.

test("the promotion's own name comes off the front", () => {
  assert.equal(eventTitleBesideMark("UFC 322", "UFC"), "322");
  assert.equal(eventTitleBesideMark("PFL 5", "PFL"), "5");
  assert.equal(eventTitleBesideMark("Bellator 301", "Bellator"), "301");
});

test("a separator after the name goes with it", () => {
  assert.equal(eventTitleBesideMark("UFC: Smith vs Jones", "UFC"), "Smith vs Jones");
  assert.equal(eventTitleBesideMark("UFC — Smith vs Jones", "UFC"), "Smith vs Jones");
  assert.equal(eventTitleBesideMark("UFC - Smith vs Jones", "UFC"), "Smith vs Jones");
});

test("the rest of a descriptive title survives intact", () => {
  assert.equal(
    eventTitleBesideMark("UFC Fight Night: Smith vs Jones", "UFC"),
    "Fight Night: Smith vs Jones",
  );
});

test("the canonical name is preferred over the monogram, so no orphan fragment is left", () => {
  // The monogram "ONE" alone would leave "Championship 172".
  assert.equal(eventTitleBesideMark("ONE Championship 172", "ONE Championship"), "172");
});

test("a SERIES name is never stripped — only the org's own name", () => {
  // The regression this rule exists to prevent. Matching aliases include
  // "one friday fights"; stripping by them yields "46", which loses the series
  // and collides with "ONE 46", a completely different card.
  assert.equal(eventTitleBesideMark("ONE Friday Fights 46", "ONE Championship"), "Friday Fights 46");
  assert.equal(eventTitleBesideMark("ONE Fight Night 39", "ONE Championship"), "Fight Night 39");
});

test("the monogram must end on a word boundary", () => {
  // Bellator's mark is "BEL". Without a boundary check "Bellator 301" renders
  // as "lator 301".
  assert.equal(eventTitleBesideMark("Bellator 301", "Bellator"), "301");
  assert.equal(eventTitleBesideMark("BKFC 70", "BKFC"), "70");
});

test("a title that IS just the promotion keeps its name", () => {
  // Stripping leaves nothing, and an empty card title is worse than a repeated one.
  assert.equal(eventTitleBesideMark("UFC", "UFC"), "UFC");
  assert.equal(eventTitleBesideMark("PFL", "PFL"), "PFL");
});

test("a promotion mentioned mid-title is not a prefix and is left alone", () => {
  assert.equal(eventTitleBesideMark("Road to UFC 3", "Road to UFC"), "3");
  // Resolving "UFC" against a Road to UFC title must not chew the middle out.
  assert.equal(eventTitleBesideMark("The Road to UFC 3", "UFC"), "The Road to UFC 3");
});

test("an unattributed or unknown promotion never rewrites the title", () => {
  assert.equal(eventTitleBesideMark("Boxing — 26 Jul 2026", "Various"), "Boxing — 26 Jul 2026");
  assert.equal(eventTitleBesideMark("Some Local Show 4", null), "Some Local Show 4");
  assert.equal(eventTitleBesideMark("Some Local Show 4", "Multiple promotions"), "Some Local Show 4");
});

test("matching is case-insensitive and whitespace-tolerant", () => {
  assert.equal(eventTitleBesideMark("ufc 322", "UFC"), "322");
  assert.equal(eventTitleBesideMark("  UFC 322  ", "UFC"), "322");
});

test("an empty title is returned unchanged, not crashed on", () => {
  assert.equal(eventTitleBesideMark("", "UFC"), "");
});
