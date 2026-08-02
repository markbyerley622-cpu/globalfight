import { test } from "node:test";
import assert from "node:assert/strict";
import { sportFromWeightClass, dominantSport } from "@/lib/scraper/ruleset";

// ~250 ONE Friday Fights / ONE Lumpinee cards — ONE's Muay Thai series — were
// ingested as MMA because the year-page source pins one sport per PROMOTION and
// ONE runs four rulesets. Wikipedia states each bout's ruleset inside the weight
// class, so the card's sport is readable rather than assumed.

test("the ruleset is read out of the weight class", () => {
  assert.equal(sportFromWeightClass("Featherweight Muay Thai"), "MUAY_THAI");
  assert.equal(sportFromWeightClass("Women's Atomweight Kickboxing"), "KICKBOXING");
  assert.equal(sportFromWeightClass("Bantamweight MMA"), "MMA");
  assert.equal(sportFromWeightClass("Catchweight (150 lbs) Muay Thai"), "MUAY_THAI");
  assert.equal(sportFromWeightClass("Lightweight Submission Grappling"), "BJJ_NOGI");
});

test("spacing and case variants of Muay Thai all resolve", () => {
  for (const s of ["muay thai", "MUAY THAI", "Muaythai", "Flyweight  Muay  Thai"]) {
    assert.equal(sportFromWeightClass(s), "MUAY_THAI", s);
  }
});

test("Muay Thai is tested before anything that could swallow it", () => {
  // A naive "boxing" test would claim this one; "Thai boxing" is Muay Thai.
  assert.equal(sportFromWeightClass("Welterweight Muay Thai (Thai boxing)"), "MUAY_THAI");
});

test("a weight class naming no ruleset yields nothing — never a guess", () => {
  for (const s of ["Featherweight", "Catchweight (155 lbs)", "Women's Strawweight", "", null, undefined]) {
    assert.equal(sportFromWeightClass(s), null, String(s));
  }
});

// ── dominantSport ─────────────────────────────────────────────────────────

test("THE BUG: a ONE Friday Fights card reads as Muay Thai, not MMA", () => {
  const card = [
    { weightClass: "Featherweight Muay Thai" },
    { weightClass: "Bantamweight Muay Thai" },
    { weightClass: "Women's Atomweight Kickboxing" },
    { weightClass: "Flyweight Muay Thai" },
  ];
  assert.equal(dominantSport(card, "MMA"), "MUAY_THAI");
});

test("a numbered ONE card with one Muay Thai title bout stays MMA", () => {
  const card = [
    { weightClass: "Lightweight MMA" },
    { weightClass: "Featherweight Muay Thai" },
    { weightClass: "Welterweight MMA" },
    { weightClass: "Strawweight MMA" },
  ];
  assert.equal(dominantSport(card, "MMA"), "MMA");
});

test("no bout naming a ruleset keeps the promotion's configured sport", () => {
  // Every promotion that runs ONE ruleset never labels it — the common case.
  assert.equal(dominantSport([{ weightClass: "Heavyweight" }, { weightClass: null }], "BOXING"), "BOXING");
  assert.equal(dominantSport([], "KICKBOXING"), "KICKBOXING");
});

test("a tie breaks toward the configured sport, never arbitrarily", () => {
  const card = [{ weightClass: "Featherweight Muay Thai" }, { weightClass: "Bantamweight MMA" }];
  assert.equal(dominantSport(card, "MMA"), "MMA");
  assert.equal(dominantSport(card, "MUAY_THAI"), "MUAY_THAI");
});

test("a tie with the fallback absent falls to card order, deterministically", () => {
  const card = [{ weightClass: "Featherweight Muay Thai" }, { weightClass: "Bantamweight Kickboxing" }];
  assert.equal(dominantSport(card, "BOXING"), "MUAY_THAI");
  assert.equal(dominantSport(card.slice().reverse(), "BOXING"), "KICKBOXING");
});
