// The windowing that makes a 423-event sweep fit a 5-minute cron and still
// reach every event. See ../sweep.
import { test } from "node:test";
import assert from "node:assert/strict";
import { planOneSweep } from "../sweep";

const FRESH = 16;
const TAIL = 16;

test("a tick reads the fresh prefix plus a slice of the archive", () => {
  const p = planOneSweep(423, NaN, FRESH, TAIL);
  assert.equal(p.indices.length, FRESH + TAIL);
  assert.deepEqual(p.indices.slice(0, FRESH), [...Array(FRESH).keys()]);
  // The archive starts behind the fresh prefix, never on top of it.
  assert.equal(p.indices[FRESH], FRESH);
  assert.equal(p.nextCursor, FRESH + TAIL);
  assert.equal(p.wrapped, false);
});

test("the archive window advances instead of restarting", () => {
  const first = planOneSweep(423, NaN, FRESH, TAIL);
  const second = planOneSweep(423, first.nextCursor, FRESH, TAIL);
  // The freshest events are re-read every tick — that is the point of them.
  assert.deepEqual(second.indices.slice(0, FRESH), first.indices.slice(0, FRESH));
  // ...but the archive slice must be new ground, or the tail starves.
  const firstTail = new Set(first.indices.slice(FRESH));
  assert.ok(second.indices.slice(FRESH).every((i) => !firstTail.has(i)));
});

test("every event is eventually visited", () => {
  const total = 423;
  const seen = new Set<number>();
  let cursor = NaN;
  // Enough ticks to cover the archive once over: (423-16)/16 ≈ 26.
  for (let tick = 0; tick < 30; tick++) {
    const p = planOneSweep(total, cursor, FRESH, TAIL);
    p.indices.forEach((i) => seen.add(i));
    cursor = p.nextCursor;
  }
  assert.equal(seen.size, total, "the sweep must not strand any event");
});

test("the tail wraps back to the archive head, never past the end", () => {
  const total = 40;
  let cursor = NaN;
  for (let tick = 0; tick < 12; tick++) {
    const p = planOneSweep(total, cursor, FRESH, TAIL);
    assert.ok(p.indices.every((i) => i >= 0 && i < total), `index out of range on tick ${tick}`);
    assert.ok(p.nextCursor >= FRESH && p.nextCursor < total);
    cursor = p.nextCursor;
  }
});

test("a corrupt or stale cursor resets rather than stopping ingestion", () => {
  for (const bad of [NaN, -1, 0, 5, 99_999, Number.POSITIVE_INFINITY]) {
    const p = planOneSweep(423, bad, FRESH, TAIL);
    assert.equal(p.indices[FRESH], FRESH, `cursor ${bad} did not reset to the archive head`);
  }
});

test("degenerate inputs yield no fetches rather than throwing", () => {
  assert.deepEqual(planOneSweep(0, 0, FRESH, TAIL).indices, []);
  assert.deepEqual(planOneSweep(-5, 0, FRESH, TAIL).indices, []);
  // Fewer events than the fresh window: read them all, ask for no archive.
  const small = planOneSweep(5, NaN, FRESH, TAIL);
  assert.deepEqual(small.indices, [0, 1, 2, 3, 4]);
  assert.equal(small.wrapped, false);
});

// ── The fresh (announcement-catching) window ────────────────────────────────
// `?window=fresh` runs the sweep with tail=0 so it reads only recently-changed
// events. Cheap enough to run daily, which is the point: ONE announces Friday
// Fights cards days ahead, and a twice-weekly archive walk shows "Card to be
// announced" for days after the card is public.
test("a fresh run reads only the recently-changed prefix", () => {
  const p = planOneSweep(423, 200, FRESH, 0);
  assert.equal(p.indices.length, FRESH);
  assert.deepEqual(p.indices, [...Array(FRESH).keys()]);
  assert.equal(p.wrapped, false);
});

test("tail=0 returns the archive HEAD — which the runner must NOT persist", () => {
  // This is the trap the runner guards. With no tail window there is no position
  // to advance, so the planner reports the archive head. Writing that on every
  // frequent fresh run would rewind the slow archive walk to its first slice and
  // it would never progress. runner.ts keeps the stored cursor for a fresh run;
  // this asserts WHY that guard has to exist, so removing it fails here too.
  const deepIntoArchive = 300;
  const p = planOneSweep(423, deepIntoArchive, FRESH, 0);
  assert.equal(p.nextCursor, FRESH, "planner reports the head, not the caller's position");
  assert.notEqual(p.nextCursor, deepIntoArchive);
});

test("a fresh run and an archive run cover the same freshest events", () => {
  const fresh = planOneSweep(423, 200, FRESH, 0);
  const full = planOneSweep(423, 200, FRESH, TAIL);
  assert.deepEqual(fresh.indices, full.indices.slice(0, FRESH));
});
