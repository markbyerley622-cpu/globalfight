import { test } from "node:test";
import assert from "node:assert/strict";
import { containsSameCard } from "@/services/dedupe/events";
import { normalizeName } from "@/services/normalization/names";

// Regression: event identity used bare substring containment, so any card whose
// name was a prefix of another's on the same date resolved to that other card's
// row. ONE ran Fists Of Fury 1, 2 AND 3 on 2021-02-26; all three collapsed onto
// one event and 73 bouts across 12 events were written onto the wrong card —
// silently, with every card still looking plausible.
//
// PURE: no prisma, no network.

const same = (a: string, b: string) => containsSameCard(normalizeName(a), normalizeName(b));

test("a longer name that only ADDS a headline is the same card", () => {
  assert.equal(same("UFC 300", "UFC 300: Pereira vs Hill"), true);
  assert.equal(same("ONE Fight Night 45", "ONE Fight Night 45: Lessei vs Rabah"), true);
  assert.equal(same("Glory 98", "Glory 98 Rotterdam"), true);
});

test("a number that distinguishes two cards is NOT a headline", () => {
  assert.equal(same("ONE Championship: Fists Of Fury", "ONE Championship: Fists Of Fury 2"), false);
  assert.equal(same("ONE Championship: Fists Of Fury 2", "ONE Championship: Fists Of Fury 3"), false);
  assert.equal(same("ONE Championship: No Surrender", "ONE Championship: No Surrender 2"), false);
});

test("a card number is not a prefix of a longer card number", () => {
  // The same failure with no sequel involved: "1" ⊂ "10".
  assert.equal(same("UFC Fight Night 1", "UFC Fight Night 10"), false);
  assert.equal(same("Glory 9", "Glory 98"), false);
  assert.equal(same("ONE Friday Fights 16", "ONE Friday Fights 164"), false);
});

test("identical names still match", () => {
  assert.equal(same("Glory 98", "Glory 98"), true);
  assert.equal(same("ONE Championship: Fists Of Fury 2", "ONE Championship: Fists Of Fury 2"), true);
});

test("unrelated cards never match", () => {
  assert.equal(same("Glory 98", "UFC 300"), false);
  assert.equal(same("ONE 168", "Glory Collision 8"), false);
});

test("containment is symmetric — argument order cannot change identity", () => {
  for (const [a, b] of [
    ["UFC 300", "UFC 300: Pereira vs Hill"],
    ["ONE Championship: Fists Of Fury", "ONE Championship: Fists Of Fury 2"],
    ["UFC Fight Night 1", "UFC Fight Night 10"],
  ] as const) {
    assert.equal(same(a, b), same(b, a), `${a} / ${b}`);
  }
});
