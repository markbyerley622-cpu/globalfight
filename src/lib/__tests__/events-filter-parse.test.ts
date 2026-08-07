import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { parseMulti } from "@/lib/events-query";
import { toCountryCode } from "@/lib/countries";

describe("country filter — case must match what is STORED", () => {
  // Regression. buildWhere used to `.toUpperCase()` each country value before
  // querying `countryCode IN (...)`.
  //
  // Event.countryCode is written by services/sync/persist as toCountryCode(),
  // which returns a lowercase ISO-2 by contract. The facet pills are built from
  // that stored column, so tapping "Australia" produced `country=au`, which was
  // then upper-cased to "AU" — and SQL string comparison is case-sensitive, so
  // the query never matched the rows the pill was counted from. The Location
  // filter returned nothing, from an option the page had just offered.
  //
  // The invariant: whatever the filter derives must equal what persist writes.

  test("what the filter derives equals what persist stores", () => {
    for (const written of ["Australia", "USA", "GB", "Brazil"]) {
      const stored = toCountryCode(written);
      // The pill's value IS the stored column, so that is what round-trips.
      const [fromUrl] = parseMulti(stored ?? "");
      assert.equal(toCountryCode(fromUrl) ?? fromUrl, stored);
    }
  });

  test("stored codes are lowercase, so the filter must not upper-case", () => {
    assert.equal(toCountryCode("Australia"), "au");
    assert.equal(toCountryCode("Australia"), toCountryCode("Australia")?.toLowerCase());
  });

  test("a hand-edited link resolves to the same code as the pill", () => {
    // parseMulti lower-cases, then toCountryCode maps names and alpha-3 onto
    // the stored form — so /events?country=Australia works as well as ?country=au.
    const viaName = parseMulti("Australia").map((c) => toCountryCode(c) ?? c);
    const viaCode = parseMulti("au").map((c) => toCountryCode(c) ?? c);
    assert.deepEqual(viaName, viaCode);
  });

  test("UK resolves to the code the column actually holds", () => {
    assert.equal(toCountryCode("uk"), "gb");
  });
});

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
