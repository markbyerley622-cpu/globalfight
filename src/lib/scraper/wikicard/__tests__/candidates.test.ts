import { test } from "node:test";
import assert from "node:assert/strict";
import {
  scoreCandidate, rankCandidates, isBiographyTitle,
  PARSE_THRESHOLD, PARSE_BUDGET, COVERAGE_THRESHOLD,
} from "../candidates";
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

// ════════════════════════════════════════════════════════════════════════════
//  INCIDENT REGRESSION — a fighter biography must never outrank the season page
//  on a multi-bout card.
//
//  Observed in production: for "BKFC 91 NAPLES HUNT vs PUGLIESI" (13 bouts) the
//  pipeline accepted "Lorenzo Hunt" — one fighter's biography — because
//  own_fighter_bio (30) + one_fighter (16) = 46 beat the season page's
//  promotion + event_shape + year = 33. A biography carries ONE bout by
//  construction, so the event was reconstructed at 1/13 and then reported
//  VERIFIED. The data written was correct; the completeness claim was false.
//
//  The fix is target awareness: a candidate whose page SHAPE cannot cover the
//  target is penalised. These tests pin both directions of it, because the
//  biography path must stay fully available for a single-bout target — it is the
//  only source for bouts that never get an article of their own.
// ════════════════════════════════════════════════════════════════════════════

const SEASON_PAGE = "2026 in Bare Knuckle Fighting Championship";
const BIO_PAGE = "Lorenzo Hunt";

/** A 13-bout BKFC card — the shape that was being mis-harvested. */
const bigCardCtx = ctx({
  eventName: "BKFC 91 NAPLES HUNT vs PUGLIESI",
  promotionName: "BKFC",
  promotionAliases: ["bkfc", "bare knuckle", "bare-knuckle"],
  expectedBouts: [
    { red: ent("f_h", "Lorenzo Hunt"), blue: ent("f_p", "Walter Pugliesi") },
    ...Array.from({ length: 12 }, (_, i) => ({
      red: ent(`f_r${i}`, `Red Fighter${i}`),
      blue: ent(`f_b${i}`, `Blue Fighter${i}`),
    })),
  ],
});

test("season page outranks a fighter bio when the card has many bouts", () => {
  const season = scoreCandidate(SEASON_PAGE, bigCardCtx);
  const bio = scoreCandidate(BIO_PAGE, bigCardCtx);

  assert.equal(season.kind, "season_page");
  assert.equal(bio.kind, "fighter_bio");
  // The inversion itself — this assertion is the incident.
  assert.ok(
    season.score > bio.score,
    `season page (${season.score}) must beat the bio (${bio.score}) on a 13-bout card`,
  );
  assert.ok(bio.reasons.some((r) => r.startsWith("insufficient_yield")), "bio must say why it was demoted");
  // 1 of 13 must never clear the completeness bar, whichever page supplied it.
  assert.ok(1 / bigCardCtx.expectedBouts.length < COVERAGE_THRESHOLD);
});

test("a bio is DEMOTED but still reachable for a multi-bout card", () => {
  // The distinction that matters, and the one the first attempt at this fix got
  // wrong. A -34 penalty put the bio under PARSE_THRESHOLD, so it was never fetched
  // — which broke boxing and MMA completely: their events are SYNTHETIC cards
  // ("Boxing — 27 Jul 2026") with no season or event page anywhere on Wikipedia, so
  // the fighter's career record is the only source there is. Measured: 6 boxing
  // targets went from partially resolved to zero.
  //
  // "Fallback, not preferred" requires BOTH of these to hold.
  const bio = scoreCandidate(BIO_PAGE, bigCardCtx);
  assert.ok(bio.score < scoreCandidate(SEASON_PAGE, bigCardCtx).score, "not preferred");
  assert.ok(bio.score >= PARSE_THRESHOLD, "but still a reachable fallback");

  const { parse } = rankCandidates([BIO_PAGE, SEASON_PAGE], bigCardCtx);
  assert.equal(parse[0]?.title, SEASON_PAGE, "the season page must be parsed FIRST");
  assert.equal(parse[1]?.title, BIO_PAGE, "the bio stays available behind it");
});

test("a bio is the only candidate for a synthetic card, and must survive", () => {
  // "Boxing — 27 Jul 2026" with 2 bouts: no promotion, no event page, no season page.
  // If the bio is refused here the target yields nothing at all.
  const syntheticCtx = ctx({
    eventName: "Boxing — 27 Jul 2026",
    promotionName: null,
    promotionAliases: [],
    expectedBouts: [
      { red: ent("f_h", "Richardson Hitchins"), blue: ent("f_s", "Ricardo Salas Rodriguez") },
      { red: ent("f_b", "Edgar Berlanga"), blue: ent("f_bu", "Steven Butler") },
    ],
  });
  const { parse } = rankCandidates(["Richardson Hitchins"], syntheticCtx);
  assert.equal(parse.length, 1, "the fighter's own page must remain fetchable");
});

test("a bio is STILL preferred for a single-bout target", () => {
  // The regression guard must not break the case the bio path exists for: a bout
  // with no article of its own, read off the fighter's career record table.
  const single = scoreCandidate(BIO_PAGE, bkfcCtx);
  assert.equal(single.kind, "fighter_bio");
  assert.ok(
    !single.reasons.some((r) => r.startsWith("insufficient_yield")),
    "a 1-bout target needs only 1 bout — no penalty applies",
  );
  assert.ok(single.score >= PARSE_THRESHOLD, "must remain fetchable");
  assert.ok(
    single.score > scoreCandidate(SEASON_PAGE, bkfcCtx).score,
    "for a single bout the fighter's own record is the better page",
  );
});

test("maxYield bounds only biographies", () => {
  assert.equal(scoreCandidate(BIO_PAGE, bigCardCtx).maxYield, 1);
  assert.equal(scoreCandidate(SEASON_PAGE, bigCardCtx).maxYield, null);
});

// ════════════════════════════════════════════════════════════════════════════
//  WRONG-YEAR SEASON PAGE — a correctness guard, not an efficiency one.
//
//  verifyCard matches a parsed bout to ours on the CORNER PAIR alone, and WikiBout
//  carries no date. On a REMATCH the two meetings are therefore indistinguishable,
//  so a previous-year season page can supply the OLD fight's winner, method and
//  round for the bout we are asking about.
//
//  Observed in production (all matched, all wrong-year):
//    BKFC FN HAMMOND VANCAMP (2026-06-26) ← "2025 in Bare Knuckle…"  1 bout
//    BKFC 80 (2025-09-12)                 ← "2022 in Bare Knuckle…"  1 bout
//    BKFC 79 (2025-08-02)                 ← "2023 in Bare Knuckle…"  2 bouts
//
//  Nothing wrong was written only because best-coverage-wins happened to prefer the
//  right-year page each time. A target whose correct page does not exist yet would
//  have taken the old result.
// ════════════════════════════════════════════════════════════════════════════

test("a wrong-year season page is refused before any fetch", () => {
  const wrong = scoreCandidate("2022 in Bare Knuckle Fighting Championship", bigCardCtx);
  assert.ok(wrong.reasons.includes("wrong_season_year"));
  assert.ok(wrong.score < PARSE_THRESHOLD, "must never be fetched");

  const { parse } = rankCandidates(
    ["2022 in Bare Knuckle Fighting Championship", SEASON_PAGE], bigCardCtx,
  );
  assert.equal(parse.length, 1);
  assert.equal(parse[0]?.title, SEASON_PAGE);
});

test("the event's own year is always accepted", () => {
  assert.ok(
    !scoreCandidate("2026 in Bare Knuckle Fighting Championship", bigCardCtx)
      .reasons.includes("wrong_season_year"),
  );
});

test("the ADJACENT year is refused for a mid-year card", () => {
  // A flat ±1 tolerance was tried first and the production sweep immediately showed it
  // passing the pages it exists to stop:
  //   BKFC 73 (2025-04-26)          ← "2026 in Bare Knuckle…"  1 bout,  8%
  //   HAMMOND VANCAMP (2026-06-26)  ← "2025 in Bare Knuckle…"  1 bout,  8%
  // April and June are nowhere near a year boundary, so those can only be previous
  // meetings of the same pair. Best-coverage-wins discarded them, but that is
  // arithmetic luck rather than a guard.
  const june = ctx({
    ...bigCardCtx, eventYear: "2026", eventDate: "2026-06-26T00:00:00.000Z",
  });
  for (const y of ["2025", "2027"]) {
    assert.ok(
      scoreCandidate(`${y} in Bare Knuckle Fighting Championship`, june)
        .reasons.includes("wrong_season_year"),
      `${y} must be refused for a June card`,
    );
  }
});

test("the adjacent year IS allowed for a card at the year boundary", () => {
  // A card on 1 January is genuinely listed on the previous year's page, and one on
  // 31 December on the next — that is the only case the tolerance is for.
  const newYear = ctx({
    ...bigCardCtx, eventYear: "2026", eventDate: "2026-01-03T00:00:00.000Z",
  });
  assert.ok(
    !scoreCandidate("2025 in Bare Knuckle Fighting Championship", newYear)
      .reasons.includes("wrong_season_year"),
  );
  const newYearsEve = ctx({
    ...bigCardCtx, eventYear: "2025", eventDate: "2025-12-28T00:00:00.000Z",
  });
  assert.ok(
    !scoreCandidate("2026 in Bare Knuckle Fighting Championship", newYearsEve)
      .reasons.includes("wrong_season_year"),
  );
});

test("with no date, the adjacent year is refused — fail closed", () => {
  // bigCardCtx carries no eventDate, so the boundary cannot be checked. Refusing is
  // the safe default: the cost is one missed page, the cost of guessing is a rematch
  // inheriting the wrong fight's result.
  assert.ok(
    scoreCandidate("2025 in Bare Knuckle Fighting Championship", bigCardCtx)
      .reasons.includes("wrong_season_year"),
  );
});

test("two years out is always refused", () => {
  assert.ok(
    scoreCandidate("2028 in Bare Knuckle Fighting Championship", bigCardCtx)
      .reasons.includes("wrong_season_year"),
  );
});

test("the year guard only applies to season pages", () => {
  // A biography or event page has no year in its title and must be unaffected.
  assert.ok(!scoreCandidate("Lorenzo Hunt", bigCardCtx).reasons.includes("wrong_season_year"));
  assert.ok(!scoreCandidate("BKFC 91", bigCardCtx).reasons.includes("wrong_season_year"));
});
