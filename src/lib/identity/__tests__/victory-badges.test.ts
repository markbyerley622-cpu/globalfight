import { test } from "node:test";
import assert from "node:assert/strict";
import { predictionBadges, type BadgeContext } from "../victory-badges";

// Badges are shown on a PUBLIC card the user posts. A badge that isn't strictly
// true is a lie the user unknowingly broadcasts under their own name — so every
// rule here is tested for its exact truth condition, including the ones that
// must NOT fire.

const ctx = (over: Partial<BadgeContext> = {}): BadgeContext => ({
  correct: true,
  calledByPct: 50,
  crowdTotal: 100,
  confidence: 3,
  resultMethod: null,
  calledMethod: null,
  streak: null,
  titleFight: false,
  accuracy: 60,
  percentile: null,
  bestStreak: 0,
  reputation: 200,
  repGained: 10,
  consensusConfidence: null,
  ...over,
});

const labels = (c: BadgeContext) => predictionBadges(c).map((b) => b.label);

test("a loss carries NO badges — we never decorate a miss", () => {
  assert.deepEqual(predictionBadges(ctx({ correct: false, calledByPct: 10, percentile: 2 })), []);
});

test("very contrarian correct call → elite rarity badge with exact %", () => {
  assert.ok(labels(ctx({ calledByPct: 8, crowdTotal: 200 })).includes("Only 8% called it"));
});

test("upset badge fires 11-33%, not above", () => {
  assert.ok(labels(ctx({ calledByPct: 25 })).includes("Called the upset"));
  assert.ok(!labels(ctx({ calledByPct: 45 })).includes("Called the upset"));
});

test("no crowd badge below quorum — small crowds are not a signal", () => {
  const l = labels(ctx({ calledByPct: 8, crowdTotal: 6 }));
  assert.ok(!l.some((x) => x.includes("called it") || x.includes("Beat")));
});

test("career-best streak is distinguished from an ordinary streak", () => {
  assert.ok(labels(ctx({ streak: 6, bestStreak: 6 })).includes("Career-best 6 streak"));
  assert.ok(labels(ctx({ streak: 4, bestStreak: 9 })).includes("4-fight streak"));
});

test("reputation milestone fires only when THIS pick crossed the line", () => {
  // 245 → 255 crosses 250.
  assert.ok(labels(ctx({ reputation: 255, repGained: 10 })).includes("250 reputation"));
  // 260 → 270, no line between → no milestone badge.
  assert.ok(!labels(ctx({ reputation: 270, repGained: 10 })).some((x) => x.includes("reputation")));
  // big number formats as k.
  assert.ok(labels(ctx({ reputation: 1005, repGained: 10 })).includes("1k reputation"));
});

test("Top 5% is elite; Top 6-25% is strong; unranked shows neither", () => {
  assert.ok(labels(ctx({ percentile: 3 })).includes("Top 3% predictor"));
  assert.ok(labels(ctx({ percentile: 18 })).includes("Top 18% of callers"));
  assert.ok(!labels(ctx({ percentile: null })).some((x) => x.startsWith("Top")));
});

test("conviction badge needs high confidence AND beating consensus by a margin", () => {
  assert.ok(labels(ctx({ confidence: 5, consensusConfidence: 3 })).includes("Higher conviction than the crowd"));
  // only 0.5 over consensus → below the 0.75 margin → no badge
  assert.ok(!labels(ctx({ confidence: 4, consensusConfidence: 3.5 })).includes("Higher conviction than the crowd"));
  // no consensus data → no badge
  assert.ok(!labels(ctx({ confidence: 5, consensusConfidence: null })).includes("Higher conviction than the crowd"));
});

test("called the finish requires method-family match", () => {
  assert.ok(labels(ctx({ resultMethod: "KO", calledMethod: "KO", confidence: 4 })).includes("Called the finish"));
  assert.ok(!labels(ctx({ resultMethod: "KO", calledMethod: "SUB", confidence: 4 })).includes("Called the finish"));
});

test("badges are ranked elite-first and capped at the limit", () => {
  const badges = predictionBadges(ctx({
    calledByPct: 8, crowdTotal: 200, percentile: 2, streak: 5, bestStreak: 5,
    reputation: 255, repGained: 10, titleFight: true, confidence: 5, consensusConfidence: 3,
  }));
  assert.ok(badges.length <= 4, "capped at 4");
  assert.equal(badges[0].tier, "elite", "richest first");
  // The base-tier title badge must be crowded out by the elite achievements.
  assert.ok(!badges.some((b) => b.kind === "title"));
});
