import { test } from "node:test";
import assert from "node:assert/strict";
import { isTruncatableDb } from "./helpers";

// ════════════════════════════════════════════════════════════════════════════
//  The guard on resetDb, unit-tested without a database.
//
//  On 2026-08-07 `npm run test:integration` TRUNCATED the dev database —
//  ~9,000 fighters, 13,915 fights, ~500 ONE events. The script passed no
//  --env-file, `.env.test.local` was referenced nowhere in the repo, and Prisma
//  auto-loads `.env` on its own, so DATABASE_URL resolved to the dev database
//  and every table was dropped before the first test ran. All 179 tests passed.
//
//  The npm script now names the env file. This predicate is the backstop, and
//  it is the part that must not regress: an env file can go missing or be
//  overridden by an ambient DATABASE_URL, and the cost of being wrong once is
//  the entire dataset.
// ════════════════════════════════════════════════════════════════════════════

test("only a *_test database may be truncated", () => {
  for (const ok of ["combat_gf_test", "test", "globalfight_test", "a_test"]) {
    assert.equal(isTruncatableDb(ok), true, `${ok} should be truncatable`);
  }
});

test("the dev and production databases are refused", () => {
  // combat_gf is the one this actually destroyed.
  for (const nope of ["combat_gf", "globalfight", "postgres", "combat_reviews", "testing", "test_db", "protest"]) {
    assert.equal(isTruncatableDb(nope), false, `${nope} must NOT be truncatable`);
  }
});

test("a near-miss name does not slip through on a substring", () => {
  // "protest" ends in "test" as characters but not as a segment — the boundary
  // is what makes this a whitelist rather than a suggestion.
  assert.equal(isTruncatableDb("protest"), false);
  assert.equal(isTruncatableDb("latest"), false);
  assert.equal(isTruncatableDb("combat_gf_testing"), false);
});
