import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { parseMulti } from "@/lib/events-query";

describe("parseMulti — the multi-value filter contract", () => {
  // Every filter group on the events page goes through this, and its output
  // becomes SQL: `sport` becomes an `in`, `promotion` expands each slug into
  // its alias list and ORs a `contains` per alias. The input is a URL, which
  // anyone can type.

  test("splits, trims and lower-cases", () => {
    assert.deepEqual(parseMulti("MMA, Boxing ,kickboxing"), ["mma", "boxing", "kickboxing"]);
  });

  test("collapses duplicates", () => {
    assert.deepEqual(parseMulti("mma,MMA, mma "), ["mma"]);
  });

  test("drops empties rather than emitting blank terms", () => {
    // A blank term reaching `contains` would match every row, i.e. silently
    // widen the filter to no filter.
    assert.deepEqual(parseMulti("mma,,boxing,"), ["mma", "boxing"]);
    assert.deepEqual(parseMulti(",,,"), []);
  });

  test("absent, empty and null all mean no filter", () => {
    assert.deepEqual(parseMulti(undefined), []);
    assert.deepEqual(parseMulti(null), []);
    assert.deepEqual(parseMulti(""), []);
  });

  test("caps the number of values", () => {
    // The bound is the point of this test. Uncapped, a URL carrying hundreds of
    // comma-separated promotions fanned out into one enormous OR of `contains`
    // clauses — reachable by hand-editing a link or by a stale one that
    // accumulated values, and it is the query, not the UI, that pays.
    const many = Array.from({ length: 500 }, (_, i) => `p${i}`).join(",");
    const out = parseMulti(many);
    assert.equal(out.length, 24);
    // Keeps the FIRST values, so a legitimate selection is never reordered.
    assert.equal(out[0], "p0");
    assert.equal(out[23], "p23");
  });

  test("the cap sits far above anything the UI can produce", () => {
    // getEventFacets caps each facet list at 14, and there are fewer sports
    // than that — so no reachable sequence of taps can hit this.
    assert.equal(parseMulti(Array.from({ length: 14 }, (_, i) => `p${i}`).join(",")).length, 14);
  });
});
