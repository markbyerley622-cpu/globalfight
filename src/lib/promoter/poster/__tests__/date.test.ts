import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { parsePosterDate, parsePosterTimes } from "@/lib/promoter/poster/date";

/** Fixed "today" so year inference is deterministic. A Friday. */
const NOW = new Date(Date.UTC(2026, 7, 7)); // 2026-08-07

const on = (line: string) => parsePosterDate(line, NOW);

describe("parsePosterDate — named months", () => {
  test("the common poster form, with weekday and year", () => {
    const d = on("SATURDAY 14 NOVEMBER 2026");
    assert.deepEqual(
      { y: d?.year, m: d?.month, d: d?.day },
      { y: 2026, m: 11, d: 14 },
    );
    assert.equal(d?.yearInferred, false);
    // 14 Nov 2026 really is a Saturday, so the poster corroborates itself.
    assert.equal(d?.weekdayConfirmed, true);
  });

  test("abbreviated month and weekday", () => {
    const d = on("SAT 14 NOV 2026");
    assert.equal(d?.month, 11);
    assert.equal(d?.day, 14);
  });

  test("month-first, American style", () => {
    const d = on("November 14, 2026");
    assert.equal(d?.month, 11);
    assert.equal(d?.day, 14);
  });

  test("ordinal suffixes", () => {
    const d = on("Saturday 14th November 2026");
    assert.equal(d?.day, 14);
  });

  test("two-digit years are this century", () => {
    assert.equal(on("14 NOV 26")?.year, 2026);
  });

  test("rejects an impossible day", () => {
    assert.equal(on("31 NOVEMBER 2026"), null);
    assert.equal(on("30 FEBRUARY 2026"), null);
  });

  test("honours leap years", () => {
    assert.equal(on("29 FEBRUARY 2028")?.day, 29);
    assert.equal(on("29 FEBRUARY 2027"), null);
  });
});

describe("parsePosterDate — year inference", () => {
  test("with no year, picks the next occurrence, not a past one", () => {
    // 14 Nov is still ahead of 7 Aug 2026, so it stays in 2026.
    const d = on("14 NOVEMBER");
    assert.equal(d?.year, 2026);
    assert.equal(d?.yearInferred, true);
  });

  test("rolls to next year when the date has already passed", () => {
    // 3 March 2026 is behind us; a poster advertising it means 2027.
    const d = on("3 MARCH");
    assert.equal(d?.year, 2027);
    assert.equal(d?.yearInferred, true);
  });

  test("uses the printed WEEKDAY to choose the year", () => {
    // 14 November is a Saturday in 2026 and a Sunday in 2027. A poster saying
    // "SUNDAY 14 NOVEMBER" therefore means 2027 — the nearest occurrence is the
    // wrong answer, and the weekday is what proves it.
    const d = on("SUNDAY 14 NOVEMBER");
    assert.equal(d?.year, 2027);
    assert.equal(d?.weekdayConfirmed, true);
  });

  test("falls back to the nearest year when no weekday matches", () => {
    const d = on("14 NOVEMBER");
    assert.equal(d?.year, 2026);
    assert.equal(d?.weekdayConfirmed, false);
  });

  test("an inferred year is always flagged", () => {
    assert.equal(on("14 NOVEMBER")?.yearInferred, true);
    assert.equal(on("14 NOVEMBER 2026")?.yearInferred, false);
  });
});

describe("parsePosterDate — THE REFUSAL", () => {
  // The reason this module exists. An all-numeric date with both components
  // 12 or under cannot be read without a locale, and a poster has none.
  // Guessing is right most of the time and catastrophically wrong the rest.

  test("refuses an ambiguous numeric date rather than guessing", () => {
    assert.equal(on("03/04/2026"), null);
    assert.equal(on("04.03.2026"), null);
    assert.equal(on("11-12-2026"), null);
  });

  test("accepts a numeric date once one component settles the order", () => {
    // 14 cannot be a month, so this is unambiguously 14 November.
    const a = on("14/11/2026");
    assert.deepEqual({ m: a?.month, d: a?.day }, { m: 11, d: 14 });

    // And the American way round resolves identically.
    const b = on("11/14/2026");
    assert.deepEqual({ m: b?.month, d: b?.day }, { m: 11, d: 14 });
  });

  test("an unambiguous numeric date scores lower than a named month", () => {
    // It hinged on one number happening to exceed 12, and OCR misreads digits
    // far more often than it misreads "NOVEMBER".
    assert.ok(on("14/11/2026")!.confidence < on("14 NOVEMBER 2026")!.confidence);
  });

  test("ISO is unambiguous by definition", () => {
    const d = on("2026-11-14");
    assert.deepEqual({ y: d?.year, m: d?.month, d: d?.day }, { y: 2026, m: 11, d: 14 });
  });

  test("no date at all", () => {
    assert.equal(on("IRONFORGE FIGHT NIGHT"), null);
    assert.equal(on(""), null);
  });
});

describe("parsePosterTimes", () => {
  test("labels each time by what precedes it", () => {
    const times = parsePosterTimes("DOORS 6:00 PM · FIRST BELL 7:00 PM AEST");
    const doors = times.find((t) => t.kind === "doors");
    const bell = times.find((t) => t.kind === "firstBell");
    assert.deepEqual({ h: doors?.hour, m: doors?.minute }, { h: 18, m: 0 });
    assert.deepEqual({ h: bell?.hour, m: bell?.minute }, { h: 19, m: 0 });
  });

  test("carries the timezone abbreviation WITHOUT resolving it", () => {
    // Never converted to an offset: these abbreviations are ambiguous
    // worldwide, and resolving one wrong moves the event by hours.
    const [t] = parsePosterTimes("FIRST BELL 7:00 PM AEST");
    assert.equal(t.timezoneAbbr, "AEST");
  });

  test("handles 24-hour times", () => {
    const [t] = parsePosterTimes("DOORS 19:30");
    assert.deepEqual({ h: t.hour, m: t.minute }, { h: 19, m: 30 });
  });

  test("midnight and noon", () => {
    assert.equal(parsePosterTimes("doors 12:00 am")[0].hour, 0);
    assert.equal(parsePosterTimes("doors 12:00 pm")[0].hour, 12);
  });

  test("ignores a bare hour with no meridiem", () => {
    // "ROUND 5" and "12 BOUTS" are not times. Without a meridiem or minutes a
    // small number is not trustworthy enough to schedule an event on.
    assert.deepEqual(parsePosterTimes("SCHEDULED FOR 5 ROUNDS"), []);
  });

  test("an unlabelled time is kept but scored low", () => {
    const [t] = parsePosterTimes("7:00 PM");
    assert.equal(t.kind, "unknown");
    assert.ok(t.confidence < 0.7);
  });

  test("rejects impossible clock values", () => {
    assert.deepEqual(parsePosterTimes("doors 25:00"), []);
    assert.deepEqual(parsePosterTimes("doors 10:75"), []);
  });
});
