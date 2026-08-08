// The windowing that makes a 169-event, two-requests-each sweep fit a shared
// cron budget and still reach every event. See ../sweep.
import { test } from "node:test";
import assert from "node:assert/strict";
import { planBkfcSweep } from "../sweep";
import { parseEventNumber } from "../normalize";

const FRESH = 8;
const TAIL = 16;

test("a tick reads the fresh prefix plus a slice of the archive", () => {
  const p = planBkfcSweep(169, NaN, FRESH, TAIL);
  assert.equal(p.indices.length, FRESH + TAIL);
  assert.deepEqual(p.indices.slice(0, FRESH), [...Array(FRESH).keys()]);
  assert.equal(p.indices[FRESH], FRESH, "the archive starts behind the fresh prefix");
  assert.equal(p.nextCursor, FRESH + TAIL);
});

test("the archive window advances instead of restarting", () => {
  const first = planBkfcSweep(169, NaN, FRESH, TAIL);
  const second = planBkfcSweep(169, first.nextCursor, FRESH, TAIL);
  assert.deepEqual(second.indices.slice(0, FRESH), first.indices.slice(0, FRESH));
  const firstTail = new Set(first.indices.slice(FRESH));
  assert.ok(second.indices.slice(FRESH).every((i) => !firstTail.has(i)));
});

test("every event is eventually visited", () => {
  const total = 169;
  const seen = new Set<number>();
  let cursor = NaN;
  for (let tick = 0; tick < 15; tick++) {
    const p = planBkfcSweep(total, cursor, FRESH, TAIL);
    p.indices.forEach((i) => seen.add(i));
    cursor = p.nextCursor;
  }
  assert.equal(seen.size, total, "the sweep must not strand any event");
});

test("a corrupt or stale cursor resets rather than stopping ingestion", () => {
  for (const bad of [NaN, -1, 0, 3, 99_999, Number.POSITIVE_INFINITY]) {
    const p = planBkfcSweep(169, bad, FRESH, TAIL);
    assert.equal(p.indices[FRESH], FRESH, `cursor ${bad} did not reset to the archive head`);
    assert.ok(p.indices.every((i) => i >= 0 && i < 169));
  }
});

test("degenerate inputs yield no fetches rather than throwing", () => {
  assert.deepEqual(planBkfcSweep(0, 0, FRESH, TAIL).indices, []);
  assert.deepEqual(planBkfcSweep(-5, 0, FRESH, TAIL).indices, []);
  const small = planBkfcSweep(3, NaN, FRESH, TAIL);
  assert.deepEqual(small.indices, [0, 1, 2]);
});

// ── Event-number identity ───────────────────────────────────────────────────
// BKFC numbers collide by prefix: "BKFC 6", "BKFC 60", "BKFC 61". Anything that
// identifies an event by number must compare COMPLETE TOKENS, or BKFC 6 quietly
// receives BKFC 60's card. This provider keys events on the page slug rather
// than the number, but the number is parsed and surfaced, so the guard is
// asserted here to keep a future prefix-match from being introduced.
test("event numbers never collide by prefix", () => {
  assert.equal(parseEventNumber("BKFC 6"), 6);
  assert.equal(parseEventNumber("BKFC 60"), 60);
  assert.equal(parseEventNumber("BKFC 61"), 61);
  assert.notEqual(parseEventNumber("BKFC 60"), parseEventNumber("BKFC 6"));
  assert.notEqual(parseEventNumber("BKFC 6"), parseEventNumber("BKFC 61"));
});

test("a numbered event and a named event are distinguishable", () => {
  // "KNUCKLEMANIA II" carries no arabic number; nothing may invent one.
  assert.equal(parseEventNumber("KNUCKLEMANIA II"), null);
  assert.equal(parseEventNumber("BKFC FIGHT NIGHT BUDVA"), null);
});
