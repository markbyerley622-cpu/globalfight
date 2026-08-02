import { test } from "node:test";
import assert from "node:assert/strict";
import {
  isDecided, preventResultDowngrade, requireAttributedWinner, preventRulesetDowngrade,
} from "../result-integrity";

test("isDecided: SCHEDULED and null are not decided; outcomes are", () => {
  assert.equal(isDecided("SCHEDULED"), false);
  assert.equal(isDecided(null), false);
  assert.equal(isDecided(undefined), false);
  assert.equal(isDecided("WIN"), true);
  assert.equal(isDecided("LOSS"), true);
  assert.equal(isDecided("DRAW"), true);
  assert.equal(isDecided("NO_CONTEST"), true);
});

test("BLOCKS un-deciding: decided fight cannot be reset to SCHEDULED", () => {
  const update = { result: "SCHEDULED" as const, method: "KO" as const, winnerId: null, roundEnded: null, mainEvent: true };
  const guarded = preventResultDowngrade("WIN", update);
  // result + its dependent fields are stripped; unrelated fields survive.
  assert.equal("result" in guarded, false);
  assert.equal("method" in guarded, false);
  assert.equal("winnerId" in guarded, false);
  assert.equal("roundEnded" in guarded, false);
  assert.equal(guarded.mainEvent, true);
});

test("ALLOWS deciding: SCHEDULED fight can be set to a real result", () => {
  const update = { result: "WIN" as const, winnerId: "f1", method: "UD" as const };
  assert.deepEqual(preventResultDowngrade("SCHEDULED", update), update);
});

test("ALLOWS corrections between decided results (WIN -> DRAW overturn)", () => {
  const update = { result: "DRAW" as const, winnerId: null };
  assert.deepEqual(preventResultDowngrade("WIN", update), update);
});

test("no result in the update is untouched regardless of existing", () => {
  const update = { mainEvent: false, orderOnCard: 3 };
  assert.deepEqual(preventResultDowngrade("WIN", update), update);
  assert.deepEqual(preventResultDowngrade("SCHEDULED", update), update);
});

test("idempotent: guarding an already-guarded update is a no-op", () => {
  const update = { result: "SCHEDULED" as const, method: "KO" as const };
  const once = preventResultDowngrade("WIN", update);
  const twice = preventResultDowngrade("WIN", once);
  assert.deepEqual(twice, once);
});

// ── requireAttributedWinner ───────────────────────────────────────────────
// A WIN that names neither corner is the invalid state behind the reversed
// results: nothing can derive a record from it, so every surface invents its own
// rule for what to display. It must never reach the database.

const corners = { redId: "red-1", blueId: "blue-1" };

test("a WIN naming a real corner passes through untouched", () => {
  for (const winnerId of [corners.redId, corners.blueId]) {
    const update = { result: "WIN" as const, winnerId, method: "KO" as const, roundEnded: 2 };
    const out = requireAttributedWinner(update, corners);
    assert.equal(out.rejected, false);
    assert.deepEqual(out.update, update);
  }
});

test("a WIN with no winner is downgraded, not written", () => {
  const out = requireAttributedWinner(
    { result: "WIN" as const, winnerId: undefined, method: "TKO" as const, roundEnded: 3 },
    corners,
  );
  assert.equal(out.rejected, true);
  assert.equal("result" in out.update, false);
  assert.equal("winnerId" in out.update, false);
  assert.equal("method" in out.update, false);
  assert.equal("roundEnded" in out.update, false);
});

test("a WIN naming a fighter from a DIFFERENT bout is rejected", () => {
  const out = requireAttributedWinner({ result: "WIN" as const, winnerId: "someone-else" }, corners);
  assert.equal(out.rejected, true);
  assert.equal("winnerId" in out.update, false);
});

test("draws and no-contests legitimately have no winner and are left alone", () => {
  for (const result of ["DRAW", "NO_CONTEST", "SCHEDULED"] as const) {
    const update = { result, winnerId: undefined };
    const out = requireAttributedWinner(update, corners);
    assert.equal(out.rejected, false);
    assert.deepEqual(out.update, update);
  }
});

// ── preventRulesetDowngrade ───────────────────────────────────────────────
// Fight.ruleset is the authority for fighter discipline, and the providers that
// can state it are a minority. They all run on the same cron and touch the same
// rows, so without this the LAST writer wins and a known Muay Thai bout is
// silently downgraded to UNKNOWN by an unrelated re-ingest.

const stated = { ruleset: "MUAY_THAI", rulesetConfidence: 1 };

test("an incoming UNKNOWN never overwrites a known ruleset", () => {
  const out = preventRulesetDowngrade(stated, { ruleset: "UNKNOWN", rulesetConfidence: 0, mainEvent: true });
  assert.equal("ruleset" in out, false);
  assert.equal("rulesetConfidence" in out, false);
  assert.equal(out.mainEvent, true, "unrelated fields survive");
});

test("a weaker source never overwrites a stronger one", () => {
  // 0.8 = derived from a single-ruleset promotion; 1 = stated on the bout.
  const out = preventRulesetDowngrade(stated, { ruleset: "KICKBOXING", rulesetConfidence: 0.8 });
  assert.equal("ruleset" in out, false);
});

test("an EQUAL-confidence correction still lands", () => {
  // A fixed value from the same class of source must not be locked out.
  const out = preventRulesetDowngrade(stated, { ruleset: "KICKBOXING", rulesetConfidence: 1 });
  assert.equal(out.ruleset, "KICKBOXING");
});

test("a stronger source supersedes a weaker stored value", () => {
  const derived = { ruleset: "BOXING", rulesetConfidence: 0.8 };
  const out = preventRulesetDowngrade(derived, { ruleset: "MUAY_THAI", rulesetConfidence: 1 });
  assert.equal(out.ruleset, "MUAY_THAI");
});

test("an UNKNOWN stored value accepts anything — there is nothing to protect", () => {
  const out = preventRulesetDowngrade({ ruleset: "UNKNOWN", rulesetConfidence: null }, { ruleset: "BJJ", rulesetConfidence: 0.8 });
  assert.equal(out.ruleset, "BJJ");
});

test("an update that says nothing about the ruleset is untouched", () => {
  const update = { mainEvent: true, orderOnCard: 2 };
  assert.deepEqual(preventRulesetDowngrade(stated, update), update);
});

test("unrelated fields survive a rejection", () => {
  const out = requireAttributedWinner(
    { result: "WIN" as const, winnerId: null, mainEvent: true, orderOnCard: 0 },
    corners,
  );
  assert.equal(out.rejected, true);
  assert.equal(out.update.mainEvent, true);
  assert.equal(out.update.orderOnCard, 0);
});
