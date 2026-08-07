import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { urgencyOf, spokenRemaining, HOUR_MS, DAY_MS, type Remaining } from "@/lib/use-countdown";

const WEEK_MS = 7 * DAY_MS;

const remaining = (ms: number): Remaining => ({
  days: Math.floor(ms / DAY_MS),
  hours: Math.floor((ms % DAY_MS) / HOUR_MS),
  minutes: Math.floor((ms % HOUR_MS) / 60_000),
  seconds: Math.floor((ms % 60_000) / 1000),
  ms,
  urgency: urgencyOf(ms),
});

describe("urgencyOf — the band boundaries", () => {
  // These four bands drive colour, surface, motion AND which cells render, so a
  // boundary that is off by one millisecond is visible: a card sitting exactly
  // on 24h would show seconds and a red wash on one render and not the next.

  test("inside the hour is critical", () => {
    assert.equal(urgencyOf(0), "critical");
    assert.equal(urgencyOf(HOUR_MS - 1), "critical");
  });

  test("exactly one hour is NOT critical", () => {
    assert.equal(urgencyOf(HOUR_MS), "urgent");
  });

  test("inside the day is urgent", () => {
    assert.equal(urgencyOf(HOUR_MS), "urgent");
    assert.equal(urgencyOf(DAY_MS - 1), "urgent");
  });

  test("exactly one day is NOT urgent", () => {
    assert.equal(urgencyOf(DAY_MS), "soon");
  });

  test("inside the week is soon", () => {
    assert.equal(urgencyOf(DAY_MS), "soon");
    assert.equal(urgencyOf(WEEK_MS - 1), "soon");
  });

  test("a week or more is scheduled", () => {
    assert.equal(urgencyOf(WEEK_MS), "scheduled");
    assert.equal(urgencyOf(90 * DAY_MS), "scheduled");
  });

  test("bands are ordered and total — every duration lands in exactly one", () => {
    const probes = [0, 1, HOUR_MS - 1, HOUR_MS, DAY_MS - 1, DAY_MS, WEEK_MS - 1, WEEK_MS, 400 * DAY_MS];
    for (const ms of probes) {
      assert.ok(
        ["critical", "urgent", "soon", "scheduled"].includes(urgencyOf(ms)),
        `${ms}ms produced no band`,
      );
    }
  });
});

describe("spokenRemaining — what a screen reader is told", () => {
  // The digits are aria-hidden and tick every second; THIS is the accessible
  // name. It must stay coarse: a per-second announcement makes the page
  // unusable, so anything below a minute collapses to one phrase.

  test("reads days and hours, and drops minutes once days are present", () => {
    assert.equal(spokenRemaining(remaining(3 * DAY_MS + 4 * HOUR_MS + 7 * 60_000)), "3 days 4 hours");
  });

  test("keeps minutes once the days are gone", () => {
    assert.equal(spokenRemaining(remaining(4 * HOUR_MS + 7 * 60_000)), "4 hours 7 minutes");
  });

  test("singularises", () => {
    assert.equal(spokenRemaining(remaining(DAY_MS + HOUR_MS)), "1 day 1 hour");
    assert.equal(spokenRemaining(remaining(60_000)), "1 minute");
  });

  test("omits zero components rather than saying '0 hours'", () => {
    assert.equal(spokenRemaining(remaining(2 * DAY_MS)), "2 days");
    assert.equal(spokenRemaining(remaining(5 * 60_000)), "5 minutes");
  });

  test("never returns an empty string inside the final minute", () => {
    // Every component is 0 here. Without the fallback the accessible name would
    // be "Starts in " — an announcement with no content, at the single most
    // important moment on the surface.
    assert.equal(spokenRemaining(remaining(30_000)), "under a minute");
    assert.equal(spokenRemaining(remaining(0)), "under a minute");
  });
});
