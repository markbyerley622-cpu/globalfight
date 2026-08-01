// The sport filter's three cases. No database: SPORT_BY_SLUG is a pure map, and
// the behaviour under test is entirely "which slug resolves to which enum".

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { SPORT_BY_SLUG } from "@/lib/sports";

/**
 * Mirrors the resolution step in buildWhere (events-query.ts).
 *
 * Returns the Prisma `where.sport` value for a given filter input:
 *   undefined      -> no clause (every sport)
 *   an enum value  -> filter to it
 *   { in: [] }     -> match nothing
 */
function sportClause(input: string | undefined): unknown {
  const slug = input?.trim().toLowerCase();
  const sport = slug ? SPORT_BY_SLUG[slug] : undefined;
  if (slug && !sport) return { in: [] };
  if (sport) return sport.value;
  return undefined;
}

describe("sport filter — canonical slugs", () => {
  for (const [slug, expected] of [
    ["boxing", "BOXING"],
    ["wrestling", "WRESTLING"],
    ["mma", "MMA"],
    ["judo", "JUDO"],
    ["taekwondo", "TAEKWONDO"],
  ] as const) {
    it(`"${slug}" filters to ${expected}`, () => {
      assert.equal(sportClause(slug), expected);
    });
  }
});

describe("sport filter — normalisation", () => {
  it("accepts the ENUM casing a caller might pass by mistake", () => {
    // "/events?sport=MMA" is the exact shape that silently returned every sport.
    assert.equal(sportClause("MMA"), "MMA");
    assert.equal(sportClause("WRESTLING"), "WRESTLING");
  });

  it("accepts stray whitespace from a hand-edited URL", () => {
    assert.equal(sportClause("  boxing  "), "BOXING");
    assert.equal(sportClause("\tjudo\n"), "JUDO");
  });

  it("accepts mixed case", () => {
    assert.equal(sportClause("BoXiNg"), "BOXING");
  });
});

describe("sport filter — the regression", () => {
  // Unknown slugs fell through an `if (s)` with no `else`, applying NO sport
  // clause — so a typo or a stale link returned EVERY sport's events, looking
  // entirely deliberate. Answering a different question than the one asked is
  // worse than answering none.
  it("an unknown slug matches NOTHING, not everything", () => {
    assert.deepEqual(sportClause("boxingg"), { in: [] });
    assert.deepEqual(sportClause("kickboxingx"), { in: [] });
    assert.deepEqual(sportClause("not-a-sport"), { in: [] });
  });

  it("an unknown slug never resolves to a real sport", () => {
    assert.notEqual(sportClause("boxingg"), "BOXING");
  });

  it("NO slug still means every sport — that case is untouched", () => {
    assert.equal(sportClause(undefined), undefined);
    assert.equal(sportClause(""), undefined);
    // Whitespace-only is "nothing was asked for", not "an unknown sport".
    assert.equal(sportClause("   "), undefined);
  });
});

describe("sport registry", () => {
  it("every slug is already lower-case, so normalisation can only help", () => {
    for (const slug of Object.keys(SPORT_BY_SLUG)) {
      assert.equal(slug, slug.toLowerCase(), `slug "${slug}" is not lower-case`);
      assert.equal(slug, slug.trim(), `slug "${slug}" has whitespace`);
    }
  });

  it("covers the sports this app ingests", () => {
    for (const s of ["mma", "boxing", "wrestling", "judo", "taekwondo", "sambo", "bjj"]) {
      assert.ok(SPORT_BY_SLUG[s], `missing slug: ${s}`);
    }
  });
});
