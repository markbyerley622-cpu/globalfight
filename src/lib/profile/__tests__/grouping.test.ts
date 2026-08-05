import { test } from "node:test";
import assert from "node:assert/strict";
import { groupResults, type GroupableRow } from "@/lib/profile/grouping";

// ════════════════════════════════════════════════════════════════════════════
//  The grouping and tallying rules behind Recent Results.
//
//  Extracted from the Prisma query so it can be tested without a database: the
//  interesting logic is not the SELECT, it is what happens to twelve picks from
//  one card and how a void bout is counted. Those are the parts that would
//  silently misreport someone's record.
// ════════════════════════════════════════════════════════════════════════════

const row = (over: Partial<GroupableRow> = {}): GroupableRow => ({
  fightSlug: "f1",
  eventSlug: "ufc-300",
  eventName: "UFC 300",
  promotion: "UFC",
  eventDate: "2026-04-13T00:00:00.000Z",
  redName: "Red Fighter",
  blueName: "Blue Fighter",
  pickedName: "Red Fighter",
  winnerName: "Red Fighter",
  finish: "KO/TKO",
  status: "SETTLED_CORRECT",
  correct: true,
  points: 12,
  date: "2026-04-13T00:00:00.000Z",
  ...over,
});

test("no completed picks groups to nothing", () => {
  assert.deepEqual(groupResults([]), []);
});

test("one completed pick makes one group", () => {
  const g = groupResults([row()]);
  assert.equal(g.length, 1);
  assert.equal(g[0].eventName, "UFC 300");
  assert.equal(g[0].picks.length, 1);
});

test("many picks from ONE card collapse into a single group", () => {
  // The reason grouping exists: twelve rows repeating "UFC 300" buries the
  // thing a visitor is scanning for.
  const rows = Array.from({ length: 12 }, (_, i) => row({ fightSlug: `f${i}` }));
  const g = groupResults(rows);
  assert.equal(g.length, 1);
  assert.equal(g[0].picks.length, 12);
});

test("mixed promotions stay in separate groups, in input order", () => {
  const g = groupResults([
    row({ fightSlug: "a", eventSlug: "ufc-300", eventName: "UFC 300", promotion: "UFC" }),
    row({ fightSlug: "b", eventSlug: "pfl-1", eventName: "PFL 1", promotion: "PFL" }),
    row({ fightSlug: "c", eventSlug: "bkfc-9", eventName: "BKFC 9", promotion: "BKFC" }),
    row({ fightSlug: "d", eventSlug: "one-fn", eventName: "ONE Fight Night", promotion: "ONE Championship" }),
    row({ fightSlug: "e", eventSlug: "mr-box", eventName: "Matchroom Boxing", promotion: "Matchroom" }),
    // A second bout from the FIRST card, arriving after the others.
    row({ fightSlug: "f", eventSlug: "ufc-300", eventName: "UFC 300", promotion: "UFC" }),
  ]);
  assert.deepEqual(g.map((x) => x.promotion), ["UFC", "PFL", "BKFC", "ONE Championship", "Matchroom"]);
  assert.equal(g[0].picks.length, 2, "the late UFC bout joins its own card, not a new group");
});

test("ordering is preserved — the caller sorts, grouping never re-sorts", () => {
  // The query returns newest-event-first; grouping must not disturb that, or the
  // page would need a second sort that could disagree with it.
  const g = groupResults([
    row({ fightSlug: "new", eventSlug: "e2", eventName: "Newer", eventDate: "2026-05-01T00:00:00.000Z" }),
    row({ fightSlug: "old", eventSlug: "e1", eventName: "Older", eventDate: "2026-01-01T00:00:00.000Z" }),
  ]);
  assert.deepEqual(g.map((x) => x.eventName), ["Newer", "Older"]);
});

test("tallies count graded picks only — a void bout is not a miss", () => {
  const g = groupResults([
    row({ fightSlug: "a", status: "SETTLED_CORRECT", correct: true }),
    row({ fightSlug: "b", status: "SETTLED_INCORRECT", correct: false }),
    row({ fightSlug: "c", status: "VOID", correct: null }),
    row({ fightSlug: "d", status: "CANCELLED", correct: null }),
  ]);
  assert.equal(g[0].picks.length, 4, "every pick is still shown");
  assert.equal(g[0].gradedCount, 2, "only the two graded ones count");
  assert.equal(g[0].correctCount, 1);
});

test("a pick still awaiting a result is shown but not counted", () => {
  const g = groupResults([
    row({ fightSlug: "a", status: "AWAITING_RESULT", correct: null, winnerName: null }),
  ]);
  assert.equal(g[0].picks.length, 1);
  assert.equal(g[0].gradedCount, 0, "nothing to grade yet");
  assert.equal(g[0].correctCount, 0);
});

test("a fight with no event groups under its own bout, never into a shared bucket", () => {
  // Two eventless fights must not collapse together under one nameless header.
  const g = groupResults([
    row({ fightSlug: "x", eventSlug: null, eventName: null, redName: "A", blueName: "B" }),
    row({ fightSlug: "y", eventSlug: null, eventName: null, redName: "C", blueName: "D" }),
  ]);
  assert.equal(g.length, 2);
  assert.equal(g[0].eventName, "A vs B");
  assert.equal(g[1].eventName, "C vs D");
});

test("points pass through untouched, including negatives and zero", () => {
  // Read from the reputation ledger, never recomputed — so grouping must not
  // coerce or default them.
  const g = groupResults([
    row({ fightSlug: "a", points: 18 }),
    row({ fightSlug: "b", points: -4 }),
    row({ fightSlug: "c", points: 0 }),
    row({ fightSlug: "d", points: null }),
  ]);
  assert.deepEqual(g[0].picks.map((p) => p.points), [18, -4, 0, null]);
});
