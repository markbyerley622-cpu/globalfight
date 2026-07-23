import { test } from "node:test";
import assert from "node:assert/strict";
import { winnerCorner, upsetFactor, pickReputation, REP, type FightOutcome } from "../scoring";

// The prediction engine's correctness core. A bug here silently mis-grades every
// pick on the card and mis-pays the leaderboard, with no other test to catch it.

const base = (over: Partial<FightOutcome> = {}): FightOutcome => ({
  result: "WIN",
  winnerId: "red-id",
  redId: "red-id",
  blueId: "blue-id",
  red: { slug: "red-slug" },
  blue: { slug: "blue-slug" },
  ...over,
});

// ── winnerCorner ────────────────────────────────────────────────────────────

test("winnerCorner: WIN by red fighter id → RED", () => {
  assert.equal(winnerCorner(base({ winnerId: "red-id" })), "RED");
});

test("winnerCorner: WIN by blue fighter id → BLUE", () => {
  assert.equal(winnerCorner(base({ winnerId: "blue-id" })), "BLUE");
});

test("winnerCorner: winnerId stored as a SLUG resolves to the corner", () => {
  assert.equal(winnerCorner(base({ winnerId: "red-slug" })), "RED");
  assert.equal(winnerCorner(base({ winnerId: "blue-slug" })), "BLUE");
});

test("winnerCorner: non-WIN results are void (null)", () => {
  for (const result of ["DRAW", "NO_CONTEST", "SCHEDULED", "DQ"]) {
    assert.equal(winnerCorner(base({ result })), null, `result=${result}`);
  }
});

test("winnerCorner: WIN with no winnerId → null", () => {
  assert.equal(winnerCorner(base({ winnerId: null })), null);
});

test("winnerCorner: winnerId matching neither corner → null (no mis-grade)", () => {
  assert.equal(winnerCorner(base({ winnerId: "someone-else" })), null);
});

// ── upsetFactor ─────────────────────────────────────────────────────────────

test("upsetFactor: void bout is neutral 0.5", () => {
  assert.equal(upsetFactor(0, 10, false), 0.5);
});

test("upsetFactor: no picks is neutral 0.5", () => {
  assert.equal(upsetFactor(0, 0, true), 0.5);
});

test("upsetFactor: everyone on the winner → 0 (obvious favourite pays floor)", () => {
  assert.equal(upsetFactor(10, 10, true), 0);
});

test("upsetFactor: nobody on the winner → 1 (max upset)", () => {
  assert.equal(upsetFactor(0, 10, true), 1);
});

test("upsetFactor: 1 of 4 called it → 0.75", () => {
  assert.equal(upsetFactor(1, 4, true), 0.75);
});

// ── pickReputation ──────────────────────────────────────────────────────────

test("pickReputation: floor — favourite, neutral confidence, no streak", () => {
  // base = CORRECT_BASE (4) + 0 ; ×1.0 ; +0
  assert.equal(pickReputation({ upsetFactor: 0, confidence: 3, streak: 0 }), REP.CORRECT_BASE);
});

test("pickReputation: max upset pays base + full bonus", () => {
  // base = 4 + 16 = 20 ; ×1.0 ; +0
  assert.equal(pickReputation({ upsetFactor: 1, confidence: 3, streak: 0 }), 20);
});

test("pickReputation: null confidence is treated as neutral 3★", () => {
  assert.equal(
    pickReputation({ upsetFactor: 0.5, confidence: null, streak: 0 }),
    pickReputation({ upsetFactor: 0.5, confidence: 3, streak: 0 }),
  );
});

test("pickReputation: confidence multiplier spans 0.8×..1.2×", () => {
  // base 4 ; 1★ ×0.8 = 3.2→3 ; 5★ ×1.2 = 4.8→5
  assert.equal(pickReputation({ upsetFactor: 0, confidence: 1, streak: 0 }), 3);
  assert.equal(pickReputation({ upsetFactor: 0, confidence: 5, streak: 0 }), 5);
});

test("pickReputation: streak bonus grows then caps at 5 steps", () => {
  const floor = pickReputation({ upsetFactor: 0, confidence: 3, streak: 0 });
  assert.equal(pickReputation({ upsetFactor: 0, confidence: 3, streak: 3 }), floor + 3 * REP.STREAK_STEP);
  // min(streak, 5): streak 10 pays the same as streak 5
  assert.equal(
    pickReputation({ upsetFactor: 0, confidence: 3, streak: 10 }),
    pickReputation({ upsetFactor: 0, confidence: 3, streak: 5 }),
  );
});

test("pickReputation: upsetFactor is clamped to [0,1] (anti-exploit)", () => {
  assert.equal(
    pickReputation({ upsetFactor: 5, confidence: 3, streak: 0 }),
    pickReputation({ upsetFactor: 1, confidence: 3, streak: 0 }),
  );
  assert.equal(
    pickReputation({ upsetFactor: -1, confidence: 3, streak: 0 }),
    pickReputation({ upsetFactor: 0, confidence: 3, streak: 0 }),
  );
});

test("pickReputation: combined case is deterministic", () => {
  // base = 4 + round(16×0.5=8) = 12 ; ×(0.7+0.4=1.1) = 13.2→13 ; + min(2,5)×2 = 4  ⇒ 17
  assert.equal(pickReputation({ upsetFactor: 0.5, confidence: 4, streak: 2 }), 17);
});
