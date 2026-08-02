import { test } from "node:test";
import assert from "node:assert/strict";
import {
  isDecided, preventResultDowngrade, requireAttributedWinner, preventRulesetDowngrade,
  assertWinnerMatchesCorners, resolveWinnerForCorners, WinnerInvariantError,
} from "../result-integrity";

// ════════════════════════════════════════════════════════════════════════════
//  THE WINNER INVARIANT
//
//  At commit, exactly one of these is true: winnerId === redId, winnerId ===
//  blueId, winnerId === null. Nothing else is ever legal.
//
//  Eight rows reached the impossible state because validation ran against the
//  INCOMING corners and persistence then discarded them for the STORED ones:
//      red "Soe Htet Oo"          winner "Soe Lin Oo"
//      red "Pentor SP Kansard…"   winner "Pentor SP.Kansart…"
//      red "Fritz Aldin Biagtan"  winner "Fritz Biagtan"
//  Near-identical names resolving to different fighter rows, matched by the slug
//  fallback where the corners are NOT the incoming ones.
// ════════════════════════════════════════════════════════════════════════════

const RED = "f-red", BLUE = "f-blue", STRANGER = "f-stranger";

test("INVARIANT: a winner on either corner is legal", () => {
  assert.doesNotThrow(() => assertWinnerMatchesCorners(RED, RED, BLUE, "t"));
  assert.doesNotThrow(() => assertWinnerMatchesCorners(BLUE, RED, BLUE, "t"));
});

test("INVARIANT: a null winner is legal — an undecided or drawn bout", () => {
  assert.doesNotThrow(() => assertWinnerMatchesCorners(null, RED, BLUE, "t"));
  assert.doesNotThrow(() => assertWinnerMatchesCorners(undefined, RED, BLUE, "t"));
});

test("INVARIANT: a winner on NEITHER corner throws — the impossible state", () => {
  assert.throws(
    () => assertWinnerMatchesCorners(STRANGER, RED, BLUE, "update f-1 (wikipedia-year)"),
    (e: unknown) => e instanceof WinnerInvariantError,
  );
});

test("INVARIANT: the error names the offending ids and the context", () => {
  // A production log line has to be actionable without a debugger attached.
  try {
    assertWinnerMatchesCorners(STRANGER, RED, BLUE, "update f-1 (wikipedia-year)");
    assert.fail("should have thrown");
  } catch (e) {
    const msg = (e as Error).message;
    assert.match(msg, /f-stranger/);
    assert.match(msg, /f-red/);
    assert.match(msg, /f-blue/);
    assert.match(msg, /wikipedia-year/);
  }
});

// ── resolveWinnerForCorners ───────────────────────────────────────────────

test("RESOLVE: a winner already on the final corners passes through", () => {
  assert.deepEqual(resolveWinnerForCorners(RED, RED, BLUE), { winnerId: RED, unmatched: false });
  assert.deepEqual(resolveWinnerForCorners(BLUE, RED, BLUE), { winnerId: BLUE, unmatched: false });
});

test("RESOLVE: THE BUG — a winner not on the STORED corners is dropped, not mapped", () => {
  // The incoming provider resolved "Soe Lin Oo" while the stored bout has
  // "Soe Htet Oo". Mapping across would be a guess about identity; a wrong
  // winner silently rewrites a fighter's record.
  const r = resolveWinnerForCorners(STRANGER, RED, BLUE);
  assert.equal(r.winnerId, null);
  assert.equal(r.unmatched, true, "the caller must be able to log it");
});

test("RESOLVE: no candidate is not an 'unmatched' event", () => {
  // A draw or an undecided bout legitimately has no winner — that must not be
  // logged as a data problem or the signal is drowned.
  assert.deepEqual(resolveWinnerForCorners(null, RED, BLUE), { winnerId: null, unmatched: false });
  assert.deepEqual(resolveWinnerForCorners(undefined, RED, BLUE), { winnerId: null, unmatched: false });
});

test("RESOLVE: corner SWAP is legal — orientation is not identity", () => {
  // Sources disagree about which fighter is "red". winnerId is a fighter id and
  // therefore orientation-independent, so a swapped pair still resolves.
  assert.equal(resolveWinnerForCorners(RED, BLUE, RED).winnerId, RED);
});

test("RESOLVE + INVARIANT compose: whatever resolve returns, assert accepts", () => {
  // The composition property that makes the pipeline safe: it is impossible for
  // resolve to hand the writer something the assertion would reject.
  for (const candidate of [RED, BLUE, STRANGER, null, undefined]) {
    const { winnerId } = resolveWinnerForCorners(candidate, RED, BLUE);
    assert.doesNotThrow(() => assertWinnerMatchesCorners(winnerId, RED, BLUE, "composed"));
  }
});

test("non-WIN results carry no winner and stay legal", () => {
  // DRAW, NO_CONTEST, technical decision, DQ — each decided, none with a winner
  // to attribute. requireAttributedWinner only polices WIN.
  for (const result of ["DRAW", "NO_CONTEST", "SCHEDULED"] as const) {
    const out = requireAttributedWinner({ result, winnerId: null }, { redId: RED, blueId: BLUE });
    assert.equal(out.rejected, false);
    assert.doesNotThrow(() => assertWinnerMatchesCorners(null, RED, BLUE, result));
  }
});

test("a DQ or technical decision WIN still needs a real corner", () => {
  // The method does not change the invariant: a win is a win, and it must be
  // attributable to someone actually on the bout.
  for (const method of ["DQ", "TD", "RTD"] as const) {
    const out = requireAttributedWinner(
      { result: "WIN" as const, method, winnerId: STRANGER },
      { redId: RED, blueId: BLUE },
    );
    assert.equal(out.rejected, true, `${method} with a foreign winner must be rejected`);
    assert.equal("winnerId" in out.update, false);
  }
});

test("BULK: no combination of candidate and corners can produce an illegal write", () => {
  // Exhaustive over the shapes a provider import can present. This is the claim
  // the whole fix rests on, so it is proved by enumeration rather than example.
  const ids = [RED, BLUE, STRANGER, null, undefined];
  const corners: Array<[string, string]> = [[RED, BLUE], [BLUE, RED], [RED, STRANGER]];
  let checked = 0;
  for (const candidate of ids) {
    for (const [r, b] of corners) {
      const { winnerId } = resolveWinnerForCorners(candidate, r, b);
      assert.doesNotThrow(() => assertWinnerMatchesCorners(winnerId, r, b, "bulk"));
      // And the resolved winner is always null or one of THESE corners.
      assert.ok(winnerId === null || winnerId === r || winnerId === b);
      checked++;
    }
  }
  assert.equal(checked, 15);
});

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
