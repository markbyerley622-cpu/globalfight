import { test } from "node:test";
import assert from "node:assert/strict";
import {
  resultCoverage, isTerminal, shouldRetry, CONVERGENCE_ATTEMPTS,
} from "../result-coverage";
import { isHistorical, HISTORICAL_GRACE_MS } from "@/lib/social/event-timing";

// This module is the ONE definition of "how complete are the results", consumed by
// the harvester, the event header and results:doctor. Every rule is pinned here
// because three surfaces previously disagreed and the user could see two of the
// answers contradict each other on a single screen.

const cov = (
  decided: number, total: number, attempts = 0, lastCoveragePct: number | null = null,
) => resultCoverage({ total, decided, attempts, lastCoveragePct });

// ── COMPLETE means complete ─────────────────────────────────────────────────

test("every bout decided is the only thing that CONFIRMS an event", () => {
  const c = cov(14, 14);
  assert.equal(c.state, "CONFIRMED");
  assert.equal(c.pct, 100);
  assert.equal(c.label, "Results confirmed");
  assert.ok(isTerminal(c.state));
  assert.equal(shouldRetry(c.state), false);
});

test("13 of 14 is NOT confirmed, however high the percentage", () => {
  // A percentage threshold was tried and rejected: at 90% a 14-bout card "completes"
  // at 13 while visibly missing a fight, and a 2-bout card can never pass at all.
  const c = cov(13, 14);
  assert.equal(c.state, "UPDATING");
  assert.ok(c.pct >= 90, "over the old threshold, and still not complete");
  assert.equal(shouldRetry(c.state), true);
});

test("1 of 2 on a small card is honest about being half done", () => {
  // The production case: Berlanga resolved, Hitchins not. The header claimed
  // "Results pending" while showing a TKO R7 below it.
  const c = cov(1, 2);
  assert.equal(c.state, "UPDATING");
  assert.equal(c.pct, 50);
  assert.match(c.detail ?? "", /1 of 2/);
});

// ── CONVERGENCE — the exit condition ───────────────────────────────────────

test("a partial card that stops improving becomes terminal, not eternal", () => {
  // 11 of 14 after repeated attempts that added nothing. Wikipedia does not list the
  // other 3 (scratched bouts, unaired prelims) and never will. Roughly half of all
  // real BKFC events landed in this band, so without an exit they would be retried
  // forever and would show a reader a spinner for data that does not exist.
  const pct = Math.round((11 / 14) * 100);
  const c = cov(11, 14, CONVERGENCE_ATTEMPTS, pct);
  assert.equal(c.state, "SOURCE_EXHAUSTED");
  assert.ok(isTerminal(c.state));
  assert.equal(shouldRetry(c.state), false);
  // Must NOT keep promising an update that is not coming.
  assert.doesNotMatch(c.detail ?? "", /hourly/);
  assert.match(c.detail ?? "", /No result was published for the other 3/);
});

test("convergence needs repeated attempts, not one bad night", () => {
  // A single failed attempt is routine — a rate limit, or a page not yet updated the
  // morning after a card.
  const c = cov(11, 14, 1, Math.round((11 / 14) * 100));
  assert.equal(c.state, "UPDATING");
});

test("coverage that is still IMPROVING never converges", () => {
  // 9 last time, 11 now: progress. Must stay retryable however many attempts it took.
  const c = cov(11, 14, 99, Math.round((9 / 14) * 100));
  assert.equal(c.state, "UPDATING");
});

test("nothing found, repeatedly, is NO_SOURCE rather than a permanent wait", () => {
  const c = cov(0, 12, CONVERGENCE_ATTEMPTS, 0);
  assert.equal(c.state, "NO_SOURCE");
  assert.ok(isTerminal(c.state));
  assert.equal(c.label, "No published results");
});

test("nothing found YET is AWAITING", () => {
  const c = cov(0, 12);
  assert.equal(c.state, "AWAITING");
  assert.equal(shouldRetry(c.state), true);
});

test("a card with no bouts is not a results problem", () => {
  // That question belongs to events/card-completeness, not here.
  assert.equal(cov(0, 0).state, "AWAITING");
  assert.equal(cov(0, 0).label, "Card not published");
});

test("decided is clamped to total — a bad count cannot produce >100%", () => {
  const c = cov(20, 14);
  assert.equal(c.pct, 100);
  assert.equal(c.state, "CONFIRMED");
});

// ── Historical notification guard ──────────────────────────────────────────

test("a past event is historical; a future one is not", () => {
  const now = new Date("2026-07-30T12:00:00Z");
  const lastYear = new Date("2025-08-02T00:00:00Z");
  const nextWeek = new Date("2026-08-06T00:00:00Z");

  // The results sweep fired ~10 "FIGHT_ANNOUNCED" bursts per run on cards up to a
  // year old — announcing, in the future tense, fights that finished months ago.
  assert.equal(isHistorical(lastYear, now), true);
  assert.equal(isHistorical(nextWeek, now), false);
});

test("a card still running is NOT historical", () => {
  // A real card runs for hours, and a mid-event change (late replacement, reshuffle)
  // is exactly when a follower most wants to hear. The grace window protects that.
  const now = new Date("2026-07-30T12:00:00Z");
  const startedThreeHoursAgo = new Date(now.getTime() - 3 * 60 * 60 * 1000);
  assert.equal(isHistorical(startedThreeHoursAgo, now), false);

  const justOutsideGrace = new Date(now.getTime() - HISTORICAL_GRACE_MS - 1000);
  assert.equal(isHistorical(justOutsideGrace, now), true);
});
