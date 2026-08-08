import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseSearchQuery } from "../search-query";

// ════════════════════════════════════════════════════════════════════════════
//  "@" IN THE SEARCH BAR.
//
//  The bug this fixes was silent and total: typing "@alex" into the site search
//  returned nothing whatsoever. The sigil went into the query verbatim, no
//  username or display name contains one, so every family matched zero rows and
//  the overlay said "No results for @alex" — about a person who exists.
// ════════════════════════════════════════════════════════════════════════════

describe("parsing what was typed", () => {
  test("a plain query is untouched and is NOT a handle query", () => {
    assert.deepEqual(parseSearchQuery("alex pereira"), { q: "alex pereira", handleQuery: false });
  });

  test("a leading @ is stripped and marks a person lookup", () => {
    assert.deepEqual(parseSearchQuery("@alex"), { q: "alex", handleQuery: true });
  });

  test("a bare @ is a real typing state, not a request for everybody", () => {
    // Returning the whole user table for one keystroke would be a directory
    // dump. The empty term is what callers read as "no query yet".
    assert.deepEqual(parseSearchQuery("@"), { q: "", handleQuery: true });
  });

  test("surrounding whitespace is ignored on both sides of the sigil", () => {
    assert.deepEqual(parseSearchQuery("  @alex  "), { q: "alex", handleQuery: true });
    assert.deepEqual(parseSearchQuery("@ alex"), { q: "alex", handleQuery: true });
  });

  test("repeated sigils are tolerated — somebody is typing", () => {
    assert.deepEqual(parseSearchQuery("@@alex"), { q: "alex", handleQuery: true });
  });

  test("an @ in the MIDDLE is not a handle query", () => {
    // An email address, or a search for a literal string. Narrowing to people
    // here would be a guess, and stripping nothing is the honest answer.
    assert.deepEqual(
      parseSearchQuery("bob@example.com"),
      { q: "bob@example.com", handleQuery: false },
    );
  });

  test("an empty box is empty, not a handle query", () => {
    assert.deepEqual(parseSearchQuery(""), { q: "", handleQuery: false });
    assert.deepEqual(parseSearchQuery("   "), { q: "", handleQuery: false });
  });

  test("handles with the full username alphabet survive", () => {
    assert.equal(parseSearchQuery("@a_b-9").q, "a_b-9");
  });

  test("a non-Latin query is passed through unharmed", () => {
    assert.deepEqual(parseSearchQuery("@Хабиб"), { q: "Хабиб", handleQuery: true });
  });
});

describe("the search route actually uses it", () => {
  const SRC = join(process.cwd(), "src");

  test("the route parses rather than reading the raw param", () => {
    // A guard rather than a round trip: the route needs Postgres to run, so
    // what is checked here is that it delegates to the tested function instead
    // of growing its own copy of the rule.
    const body = readFileSync(join(SRC, "app/api/search/route.ts"), "utf8");
    assert.ok(
      body.includes("parseSearchQuery("),
      "the search route no longer parses the query through the shared function — " +
        "a second copy of the @ rule will drift from this one",
    );
  });

  test("the handle path returns people only", () => {
    // The narrowing half. Asserted structurally because the alternative is a
    // database: what matters is that the early return exists and that it is
    // reached from `handleQuery`.
    const body = readFileSync(join(SRC, "app/api/search/route.ts"), "utf8");
    assert.ok(body.includes("if (handleQuery)"), "the handle path is gone");
  });
});
