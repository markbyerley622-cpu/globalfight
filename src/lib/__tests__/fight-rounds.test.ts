import { test } from "node:test";
import assert from "node:assert/strict";
import { displayRounds, effectiveDiscipline, BOXING_DEFAULT_ROUNDS } from "@/lib/fight-rounds";

// ════════════════════════════════════════════════════════════════════════════
//  The rule: a scheduled distance is shown only where it is credible for the
//  discipline, and OMITTED — never substituted — where it is not.
//
//  Production verification (2026-08-09) found ONE cards printing "· 12 rds" on
//  MMA and Muay Thai bouts. Nothing was wrong with the row that rendered it:
//  `Fight.scheduledRounds` is `Int @default(12)`, twelve is a boxing distance,
//  and the persist chokepoint writes that default for every bout whose source
//  gave no distance. The stored integer is identical whether it is a fact or a
//  fallback, so only the ruleset can tell them apart.
//
//  These assertions are written against the DERIVE boundary rather than a
//  rendered row, because both the event page and the fight page consume it and
//  the defect was that they each decided separately.
// ════════════════════════════════════════════════════════════════════════════

// ── The exact combination that shipped ─────────────────────────────────────
// Rebuilt literally so the suite fails if the default ever becomes displayable
// again. Without this the tests below could all pass vacuously.
test("the shipped defect: a non-boxing bout carrying the boxing default shows nothing", () => {
  // A ONE Friday Fights Muay Thai bout, stored exactly as production holds it.
  assert.equal(displayRounds(12, "MUAY_THAI", "MUAY_THAI"), null);
  // And the MMA bout on the same card, likewise.
  assert.equal(displayRounds(12, "MMA", "MMA"), null);
  // Proof the assertion is not trivially true — the same value IS shown for boxing.
  assert.equal(displayRounds(12, "BOXING", "BOXING"), 12);
});

// ── Missing round metadata must never read as twelve ───────────────────────
for (const ruleset of ["MMA", "MUAY_THAI", "KICKBOXING", "SUBMISSION_GRAPPLING", "BJJ", "WRESTLING", "BARE_KNUCKLE"]) {
  test(`${ruleset} with no supplied distance does not display ${BOXING_DEFAULT_ROUNDS} rounds`, () => {
    assert.equal(displayRounds(BOXING_DEFAULT_ROUNDS, ruleset), null);
  });
}

// ── Boxing keeps its real championship distance ────────────────────────────
test("boxing displays twelve rounds", () => {
  assert.equal(displayRounds(12, "BOXING"), 12);
  // Also when the bout itself was never labelled and only the card's sport says boxing.
  assert.equal(displayRounds(12, "UNKNOWN", "BOXING"), 12);
  assert.equal(displayRounds(12, null, "BOXING"), 12);
});

// ── A supplied distance is never overwritten or suppressed ─────────────────
test("an explicitly supplied distance always survives, in every discipline", () => {
  assert.equal(displayRounds(3, "MMA"), 3);
  assert.equal(displayRounds(5, "MMA"), 5);
  assert.equal(displayRounds(5, "MUAY_THAI"), 5);
  assert.equal(displayRounds(3, "KICKBOXING"), 3);
  assert.equal(displayRounds(5, "BARE_KNUCKLE"), 5);
  // Boxing distances other than twelve are ordinary data too.
  assert.equal(displayRounds(10, "BOXING"), 10);
  assert.equal(displayRounds(6, "BOXING"), 6);
  // A discipline this module has never heard of degrades to trusting the data,
  // not to silence — a new Ruleset enum member must not blank existing rows.
  assert.equal(displayRounds(4, "LETHWEI"), 4);
  assert.equal(displayRounds(3, "SOME_FUTURE_RULESET"), 3);
});

// ── An unestablished discipline is a gap, not an excuse to print the default ─
test("twelve is withheld when the discipline cannot be established at all", () => {
  assert.equal(displayRounds(12, "UNKNOWN", null), null);
  assert.equal(displayRounds(12, null, null), null);
  assert.equal(displayRounds(12, undefined, undefined), null);
  // ...but a non-default value is still real data and still shows.
  assert.equal(displayRounds(5, "UNKNOWN", null), 5);
});

// ── Nonsense in, nothing out ───────────────────────────────────────────────
test("absent or impossible values yield null rather than a rendered zero", () => {
  assert.equal(displayRounds(null, "MMA"), null);
  assert.equal(displayRounds(undefined, "BOXING"), null);
  assert.equal(displayRounds(0, "BOXING"), null);
  assert.equal(displayRounds(-3, "BOXING"), null);
  assert.equal(displayRounds(2.5, "BOXING"), null);
  assert.equal(displayRounds(Number.NaN, "BOXING"), null);
});

// ── Discipline resolution: the bout outranks the card ──────────────────────
test("the bout's own ruleset wins; the card's sport is only the fallback", () => {
  // A Muay Thai bout on a card billed as MMA is Muay Thai.
  assert.equal(effectiveDiscipline("MUAY_THAI", "MMA"), "MUAY_THAI");
  // UNKNOWN is the enum's "we were not told", so it defers rather than answering.
  assert.equal(effectiveDiscipline("UNKNOWN", "BOXING"), "BOXING");
  assert.equal(effectiveDiscipline(null, "BOXING"), "BOXING");
  assert.equal(effectiveDiscipline(null, null), null);
  // Case is normalised — sources and enums disagree about it.
  assert.equal(effectiveDiscipline("boxing", null), "BOXING");
  assert.equal(displayRounds(12, "boxing"), 12);
});

// ── The consequence for a real mixed card ──────────────────────────────────
test("a mixed-ruleset ONE card shows distances only where they are real", () => {
  const card = [
    { ruleset: "MUAY_THAI", scheduledRounds: 12 },   // defaulted
    { ruleset: "MMA", scheduledRounds: 3 },          // supplied
    { ruleset: "KICKBOXING", scheduledRounds: 12 },  // defaulted
    { ruleset: "SUBMISSION_GRAPPLING", scheduledRounds: 12 }, // defaulted
    { ruleset: "MMA", scheduledRounds: 5 },          // supplied
  ];
  const shown = card.map((b) => displayRounds(b.scheduledRounds, b.ruleset, "MUAY_THAI"));
  assert.deepEqual(shown, [null, 3, null, null, 5]);
});
