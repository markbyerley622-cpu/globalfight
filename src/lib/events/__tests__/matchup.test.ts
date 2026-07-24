import { test } from "node:test";
import assert from "node:assert/strict";
import { matchupIntel } from "../matchup";
import type { FighterRank } from "@/lib/events-query";

const r = (rank: number, kind: FighterRank["kind"] = "division"): FighterRank => ({ rank, kind, source: "ufc-mma" });

test("both ranked → ranked-matchup line with average", () => {
  assert.equal(matchupIntel(r(3), r(5)), "Ranked matchup · #3 vs #5 · avg 4");
});

test("a #1 involved → title implications", () => {
  assert.equal(matchupIntel(r(1), r(4)), "Title implications · #1 vs #4 · avg 2.5");
});

test("only one (or neither) ranked → null (nothing true to say)", () => {
  assert.equal(matchupIntel(r(2), null), null);
  assert.equal(matchupIntel(null, r(2)), null);
  assert.equal(matchupIntel(null, null), null);
});

test("integer average drops the trailing .0", () => {
  assert.match(matchupIntel(r(2), r(4))!, /avg 3$/);
});
