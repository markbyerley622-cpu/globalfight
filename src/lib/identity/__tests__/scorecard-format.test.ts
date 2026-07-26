import { test } from "node:test";
import assert from "node:assert/strict";
import { isPerfect, scorecardHeadline, scorecardBadges, type ScorecardFacts } from "../scorecard-format";

// The scorecard is a PUBLIC, shareable artifact. A headline or badge that isn't
// true is a claim the user broadcasts under their own name — so every rule is
// tested for its exact condition, including the ones that must NOT fire.

const f = (over: Partial<ScorecardFacts> = {}): ScorecardFacts => ({
  graded: 6, correct: 4, calledMain: false, cardsEarned: 0, repGained: 30, accuracy: 67, ...over,
});

test("isPerfect needs every graded call AND at least two", () => {
  assert.equal(isPerfect({ graded: 6, correct: 6 }), true);
  assert.equal(isPerfect({ graded: 1, correct: 1 }), false, "one call is not a card");
  assert.equal(isPerfect({ graded: 6, correct: 5 }), false);
});

test("headline summarises the user's night honestly", () => {
  assert.equal(scorecardHeadline({ graded: 6, correct: 6 }), "Perfect card.");
  assert.equal(scorecardHeadline({ graded: 5, correct: 4 }), "Sharp card.");
  assert.equal(scorecardHeadline({ graded: 6, correct: 3 }), "Solid card.");
  assert.equal(scorecardHeadline({ graded: 6, correct: 0 }), "Tough card.");
  assert.equal(scorecardHeadline({ graded: 1, correct: 1 }), "Nailed it.");
  assert.equal(scorecardHeadline({ graded: 1, correct: 0 }), "Missed it.");
  assert.equal(scorecardHeadline({ graded: 0, correct: 0 }), "No calls graded");
});

test("badges only assert true things, richest first, capped", () => {
  const b = scorecardBadges(f({ graded: 6, correct: 6, calledMain: true, cardsEarned: 2, accuracy: 100 }));
  assert.ok(b.length <= 3);
  assert.equal(b[0].label, "Perfect card");
  assert.equal(b[0].tier, "elite");
});

test("accuracy badge is suppressed on a perfect card (would be redundant)", () => {
  const labels = scorecardBadges(f({ graded: 6, correct: 6, accuracy: 100 })).map((x) => x.label);
  assert.ok(!labels.some((l) => l.includes("on the card")));
});

test("called-the-main-event is elite on a non-perfect card, and only when true", () => {
  assert.ok(scorecardBadges(f({ calledMain: true })).some((x) => x.label === "Called the main event" && x.tier === "elite"));
  assert.ok(!scorecardBadges(f({ calledMain: false })).some((x) => x.label === "Called the main event"));
});

test("cards-earned badge reflects the real count or is absent", () => {
  assert.ok(scorecardBadges(f({ cardsEarned: 1 })).some((x) => x.label === "1 card earned"));
  assert.ok(scorecardBadges(f({ cardsEarned: 4 })).some((x) => x.label === "4 cards earned"));
  assert.ok(!scorecardBadges(f({ cardsEarned: 0 })).some((x) => x.label.includes("card")));
});
