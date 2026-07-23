import { test } from "node:test";
import assert from "node:assert/strict";
import { isDecided, preventResultDowngrade } from "../result-integrity";

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
