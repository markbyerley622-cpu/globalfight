import { test } from "node:test";
import assert from "node:assert/strict";
import {
  pickStatus,
  picksLocked,
  isTerminal,
  owesSettlement,
  countsTowardRecord,
  STATUS_PRESENTATION,
  RESULT_GRACE_HOURS,
  type PickStatus,
} from "../pick-status";

// The bug these states exist to expose: a prediction whose fight HAS a winner but
// whose grading never ran used to render as "Open" — identical to a fight next
// week. Every assertion below pins one of the four situations that word covered.

const NOW = new Date("2026-07-26T12:00:00Z");
const hoursAgo = (h: number) => new Date(NOW.getTime() - h * 3_600_000).toISOString();
const hoursAhead = (h: number) => new Date(NOW.getTime() + h * 3_600_000).toISOString();

const open = { correct: null };
const hit = { correct: true };
const miss = { correct: false };

// ── the four situations "Open" used to cover ────────────────────────────────

test("a fight that hasn't happened is OPEN", () => {
  assert.equal(pickStatus(open, { result: "SCHEDULED", date: hoursAhead(48) }, NOW), "OPEN");
});

test("a fight inside the grace window is still OPEN, not a data gap", () => {
  // The card is running or just finished; sources publish later.
  assert.equal(pickStatus(open, { result: "SCHEDULED", date: hoursAgo(3) }, NOW), "OPEN");
});

test("a fight long over with no result is AWAITING_RESULT — a data gap, not our debt", () => {
  assert.equal(
    pickStatus(open, { result: "SCHEDULED", date: hoursAgo(RESULT_GRACE_HOURS + 1) }, NOW),
    "AWAITING_RESULT",
  );
});

test("a DECIDED fight with an ungraded pick is AWAITING_SETTLEMENT — the invariant violation", () => {
  // This is the exact state that used to read as "Open" and hid the bug.
  const status = pickStatus(open, { result: "WIN", date: hoursAgo(40) }, NOW);
  assert.equal(status, "AWAITING_SETTLEMENT");
  assert.equal(owesSettlement(status), true);
  assert.notEqual(STATUS_PRESENTATION[status].label, "Open");
});

test("a draw or no-contest is VOID — never a miss", () => {
  // Storing correct=false for these made them render as losses while the user's
  // record deliberately didn't count them. Void is its own terminal state.
  for (const result of ["DRAW", "NO_CONTEST"]) {
    const status = pickStatus(open, { result, date: hoursAgo(40) }, NOW);
    assert.equal(status, "VOID");
    assert.equal(countsTowardRecord(status), false);
    assert.equal(isTerminal(status), true);
  }
});

test("a void bout stays VOID even if an old row still carries correct=false", () => {
  // Backwards compatibility: rows written before void picks stopped being graded
  // false must still read as void, not as a miss.
  assert.equal(pickStatus(miss, { result: "DRAW", date: hoursAgo(40) }, NOW), "VOID");
});

// ── graded outcomes ─────────────────────────────────────────────────────────

test("graded picks settle correct / incorrect and both count", () => {
  const good = pickStatus(hit, { result: "WIN", date: hoursAgo(40) }, NOW);
  const bad = pickStatus(miss, { result: "WIN", date: hoursAgo(40) }, NOW);
  assert.equal(good, "SETTLED_CORRECT");
  assert.equal(bad, "SETTLED_INCORRECT");
  for (const s of [good, bad]) {
    assert.equal(isTerminal(s), true);
    assert.equal(countsTowardRecord(s), true);
    assert.equal(owesSettlement(s), false);
  }
});

test("a cancelled bout is CANCELLED whatever else is true of it", () => {
  assert.equal(
    pickStatus(hit, { result: "WIN", date: hoursAgo(40), cancelled: true }, NOW),
    "CANCELLED",
  );
  assert.equal(
    pickStatus(open, { result: "SCHEDULED", date: hoursAhead(48), cancelled: true }, NOW),
    "CANCELLED",
  );
});

// ── every state is presentable and no state lies ────────────────────────────

test("every status has presentation, and only OPEN is labelled 'Open'", () => {
  const all: PickStatus[] = [
    "OPEN", "AWAITING_RESULT", "AWAITING_SETTLEMENT",
    "SETTLED_CORRECT", "SETTLED_INCORRECT", "VOID", "CANCELLED",
  ];
  for (const s of all) {
    const p = STATUS_PRESENTATION[s];
    assert.ok(p, `${s} has no presentation`);
    assert.ok(p.label.length > 0 && p.detail.length > 0, `${s} presentation is empty`);
    if (s !== "OPEN") assert.notEqual(p.label, "Open", `${s} must not read as "Open"`);
  }
});

test("exactly one status means the system owes work", () => {
  const all: PickStatus[] = [
    "OPEN", "AWAITING_RESULT", "AWAITING_SETTLEMENT",
    "SETTLED_CORRECT", "SETTLED_INCORRECT", "VOID", "CANCELLED",
  ];
  assert.deepEqual(all.filter(owesSettlement), ["AWAITING_SETTLEMENT"]);
});

// ── first-bell lock ─────────────────────────────────────────────────────────

test("picksLocked closes picks the moment the card starts", () => {
  assert.equal(picksLocked(hoursAhead(1), NOW), false);
  assert.equal(picksLocked(hoursAgo(1), NOW), true);
  // Exactly at the bell counts as started — matches castPick's `<=`.
  assert.equal(picksLocked(NOW.toISOString(), NOW), true);
});

test("picksLocked never locks on missing or unparseable dates", () => {
  assert.equal(picksLocked(null, NOW), false);
  assert.equal(picksLocked(undefined, NOW), false);
  assert.equal(picksLocked("not a date", NOW), false);
});

test("picksLocked accepts a Date as well as an ISO string", () => {
  assert.equal(picksLocked(new Date(NOW.getTime() - 1000), NOW), true);
});
