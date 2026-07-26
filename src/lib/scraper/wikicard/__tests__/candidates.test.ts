import { test } from "node:test";
import assert from "node:assert/strict";
import { scoreCandidate, rankCandidates, isBiographyTitle, PARSE_THRESHOLD, PARSE_BUDGET } from "../candidates";
import { verifyCard, verifyTitle, isAcceptable } from "../verify";
import { candidate } from "@/lib/entities/resolve";
import type { WikiBout } from "../extract";

// Every title below was ACTUALLY fetched and parsed during a real historical repair
// run — full HTML, handed to cheerio, to learn nothing. Verification made them
// harmless; it did not make them free. These tests pin that they are now refused
// before any request, and that the pages we DO need are still accepted.

const ent = (id: string, name: string) => candidate("fighter", { id, slug: id, name });

const ctx = (over: Partial<Parameters<typeof scoreCandidate>[1]> = {}) => ({
  eventName: "Boxing — 24 Jul 2026",
  promotionName: null,
  promotionAliases: [],
  eventYear: "2026",
  expectedBouts: [{ red: ent("f_fury", "Tyson Fury"), blue: ent("f_wach", "Mariusz Wach") }],
  ...over,
});

const bkfcCtx = ctx({
  eventName: "BKFC 91 NAPLES HUNT vs PUGLIESI",
  promotionName: "BKFC",
  promotionAliases: ["bkfc", "bare knuckle", "bare-knuckle"],
  expectedBouts: [{ red: ent("f_h", "Lorenzo Hunt"), blue: ent("f_p", "Walter Pugliesi") }],
});

const score = (title: string, c = ctx()) => scoreCandidate(title, c).score;

// ── the observed waste, now refused ─────────────────────────────────────────

test("unrelated pages score below the parse threshold", () => {
  for (const junk of [
    "Kansas City Chiefs",
    "Heart of Midlothian F.C.",
    "2025–26 Heart of Midlothian F.C. season",
    "Castleford Tigers",
    "The Dillinger Escape Plan",
    "List of Dillinger Escape Plan band members",
    "List of transgender people",
    "List of documentary films",
    "List of Stanford University alumni",
    "List of Cuba hurricanes",
    "2026 New York State Senate election",
    "Dept. Q",
    "List of current boxing rankings",
  ]) {
    assert.ok(score(junk) < PARSE_THRESHOLD, `${junk} scored ${score(junk)} — would be fetched`);
  }
});

test("a shared single word is not evidence — 'Back 4 Blood' vs the event 'BLOOD 4 BLOOD'", () => {
  const c = ctx({
    eventName: "BLOOD 4 BLOOD",
    promotionName: "BKFC",
    promotionAliases: ["bkfc", "bare knuckle"],
    expectedBouts: [{ red: ent("a", "Austin Trout"), blue: ent("b", "Ben Bonner") }],
  });
  for (const junk of ["Back 4 Blood", "Bloods", "Blood donation"]) {
    assert.ok(scoreCandidate(junk, c).score < PARSE_THRESHOLD, `${junk} would be fetched`);
  }
});

test("OUR fighter's biography is ACCEPTED — its record table holds the result", () => {
  // This test used to assert the opposite, on the belief that a bio has no readable
  // card. It has no def./vs. CARD — but it carries the fighter's complete career
  // record, and for the long tail of bouts that never get their own article that row
  // is the only published result there is. See record-table.ts.
  assert.ok(score("Tyson Fury") >= PARSE_THRESHOLD, `scored ${score("Tyson Fury")}`);
  assert.ok(score("Mariusz Wach") >= PARSE_THRESHOLD);
  assert.ok(scoreCandidate("Josh Kelly (boxer)", ctx({
    expectedBouts: [{ red: ent("a", "Josh Kelly"), blue: ent("b", "Caoimhin Agyarko") }],
  })).score >= PARSE_THRESHOLD, "a disambiguated bio is still our fighter");
});

test("SOMEONE ELSE's biography is still refused", () => {
  // "Hughie Fury" shares a surname with our fighter and has nothing to do with the
  // bout — exactly the page that made the first run fetch 200 KB for nothing.
  assert.ok(score("Hughie Fury") < PARSE_THRESHOLD, `scored ${score("Hughie Fury")}`);
  assert.ok(score("Moses Itauma") < PARSE_THRESHOLD);
  assert.ok(score("Jermall Charlo") < PARSE_THRESHOLD);
});

// ── the pages we DO need, still accepted ────────────────────────────────────

test("a dedicated bout page scores highest of all", () => {
  const s = score("Errol Spence Jr. vs. Tim Tszyu", ctx({
    expectedBouts: [{ red: ent("a", "Errol Spence Jr"), blue: ent("b", "Tim Tszyu") }],
  }));
  assert.ok(s >= PARSE_THRESHOLD * 2, `scored ${s}`);
});

test("a UFC event page is accepted", () => {
  const s = score("UFC Fight Night: Ankalaev vs. Guskov", ctx({
    expectedBouts: [{ red: ent("a", "Magomed Ankalaev"), blue: ent("b", "Bogdan Guskov") }],
  }));
  assert.ok(s >= PARSE_THRESHOLD, `scored ${s}`);
});

test("the BKFC season page is accepted — it is genuinely the right page", () => {
  const s = scoreCandidate("2026 in Bare Knuckle Fighting Championship", bkfcCtx).score;
  assert.ok(s >= PARSE_THRESHOLD, `scored ${s}`);
});

test("promotion aliases do the work — 'bare knuckle' finds far more than 'BKFC'", () => {
  const withAliases = scoreCandidate("2026 in Bare Knuckle Fighting Championship", bkfcCtx).score;
  const without = scoreCandidate("2026 in Bare Knuckle Fighting Championship", {
    ...bkfcCtx, promotionName: "BKFC", promotionAliases: [],
  }).score;
  assert.ok(withAliases > without);
});

// ── ranking, threshold, budget ──────────────────────────────────────────────

test("candidates are ranked best-first and capped by the parse budget", () => {
  const titles = [
    "Kansas City Chiefs",
    "Tyson Fury",
    "Tyson Fury vs. Mariusz Wach",
    "List of documentary films",
    "Mariusz Wach",
  ];
  const { parse, rejected } = rankCandidates(titles, ctx());
  assert.equal(parse[0].title, "Tyson Fury vs. Mariusz Wach", "the real page is read first");
  assert.ok(parse.length <= PARSE_BUDGET);
  assert.ok(rejected.some((r) => r.title === "Kansas City Chiefs"));
  // Every rejection explains itself.
  for (const r of rejected) assert.ok(Array.isArray(r.reasons));
});

test("the budget is respected even when many candidates score well", () => {
  const many = Array.from({ length: 20 }, (_, i) => `Tyson Fury vs. Mariusz Wach (${i})`);
  assert.ok(rankCandidates(many, ctx()).parse.length <= PARSE_BUDGET);
});

test("isBiographyTitle distinguishes a person from an event", () => {
  const c = ctx();
  assert.equal(isBiographyTitle("Tyson Fury", c), true);
  assert.equal(isBiographyTitle("Josh Kelly (boxer)", c), true);
  assert.equal(isBiographyTitle("Tyson Fury vs. Mariusz Wach", c), false);
  assert.equal(isBiographyTitle("UFC Fight Night: Ankalaev vs. Guskov", c), false);
  assert.equal(isBiographyTitle("List of documentary films", c), false, "a list is not a biography");
});

// ── what may be WRITTEN: the superset bug ───────────────────────────────────

const bout = (red: string, blue: string): WikiBout => ({
  weightClass: null, ruleset: null, redName: red, blueName: blue,
  decided: true, method: "TKO", round: 3, time: null, titleFight: false,
});

test("only VERIFIED bouts are returned for persistence — never a season page's superset", () => {
  // "2026 in Bare Knuckle Fighting Championship" carries EVERY card of the year. A
  // real run attached 3,803 bouts across 20 events because the whole parsed table was
  // persisted; real cards are 10-13 bouts. That is fabricated card data, not slowness.
  const seasonPage = [
    bout("Lorenzo Hunt", "Walter Pugliesi"),   // ours
    bout("Someone Else", "Another Person"),     // a different card
    bout("Third Fighter", "Fourth Fighter"),    // a different card
  ];
  const m = verifyCard(seasonPage, bkfcCtx.expectedBouts);
  assert.equal(isAcceptable(m), true, "our bout IS on the page");
  assert.equal(m.parsed, 3);
  assert.equal(m.bouts.length, 1, "only our bout may be written");
  assert.equal(m.bouts[0].redName, "Lorenzo Hunt");
});

test("verifyTitle keeps CARD backfill working, where there is nothing to verify against", () => {
  // A card-gap target has no bouts yet, so verifyCard can never accept. Introducing
  // content verification without this would have silently broken that whole gap.
  assert.equal(verifyTitle("ONE Fight Night 39", "ONE Fight Night 39: Superlek vs Takeru"), true);
  assert.equal(verifyTitle("BKFC 91", "BKFC 91"), true);
  assert.equal(verifyTitle("BKFC 91", "Kansas City Chiefs"), false);
  assert.equal(verifyTitle("BKFC 91", "BKFC 92"), false);
});
