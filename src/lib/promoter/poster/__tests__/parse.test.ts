import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { parsePoster, draftCompleteness } from "@/lib/promoter/poster/parse";
import type { OcrLine } from "@/lib/promoter/poster/types";

const NOW = new Date(Date.UTC(2026, 7, 7));

/** Build a line with a type size, as a geometry-capable provider would return. */
const L = (text: string, height = 0): OcrLine =>
  height ? { text, box: { top: 0, left: 0, width: 0.5, height } } : { text };

/**
 * A realistic card poster, WITH geometry.
 *
 * Note the main event is deliberately NOT the first bout in reading order — the
 * undercard is listed above it here, which is a layout real posters use. Only
 * the type size says which bout is the main event, and that is the whole reason
 * the parser prefers geometry over order.
 */
const POSTER: OcrLine[] = [
  L("IRONFORGE", 0.09),
  L("FIGHT NIGHT 12", 0.11),
  L("AARON VOSS vs LIAM TORRES", 0.03),
  L("NATE KELLER vs ISAAC MORENO", 0.03),
  L("Lightweight", 0.02),
  L("JAYDEN BROOKS vs LEO RAMIREZ", 0.05),
  L("ETHAN COLE vs MARCO SILVA", 0.08),
  L("Super Welterweight Title", 0.02),
  L("SATURDAY 14 NOVEMBER 2026", 0.04),
  L("Riverstage, Brisbane, Australia", 0.025),
  L("DOORS 6:00 PM · FIRST BELL 7:00 PM AEST", 0.02),
  L("TICKETS ON SALE NOW", 0.02),
];

describe("parsePoster — the full card", () => {
  const draft = parsePoster(POSTER, NOW);

  test("finds every bout", () => {
    assert.equal(draft.bouts.length, 4);
  });

  test("ranks the card by TYPE SIZE, not reading order", () => {
    // ETHAN COLE vs MARCO SILVA is set largest but appears fifth. A parser
    // trusting reading order would crown AARON VOSS the main event.
    assert.equal(draft.bouts[0].redName.value, "ETHAN COLE");
    assert.equal(draft.bouts[0].blueName.value, "MARCO SILVA");
    assert.equal(draft.bouts[0].mainEvent, true);
    assert.equal(draft.bouts[0].orderOnCard, 0);
  });

  test("the co-main is next by size", () => {
    assert.equal(draft.bouts[1].redName.value, "JAYDEN BROOKS");
  });

  test("exactly ONE bout is the main event", () => {
    assert.equal(draft.bouts.filter((b) => b.mainEvent).length, 1);
  });

  test("orderOnCard is dense and sequential", () => {
    assert.deepEqual(draft.bouts.map((b) => b.orderOnCard), [0, 1, 2, 3]);
  });

  test("reads the date", () => {
    assert.deepEqual(
      { y: draft.date?.value.year, m: draft.date?.value.month, d: draft.date?.value.day },
      { y: 2026, m: 11, d: 14 },
    );
    assert.equal(draft.date?.value.yearInferred, false);
  });

  test("reads doors and first bell separately", () => {
    assert.deepEqual(draft.doorsAt?.value, { hour: 18, minute: 0 });
    assert.deepEqual(draft.firstBellAt?.value, { hour: 19, minute: 0 });
  });

  test("keeps the timezone as printed", () => {
    assert.equal(draft.timezoneAbbr, "AEST");
  });

  test("reads venue, city and country from the locality line", () => {
    assert.equal(draft.venue?.value, "Riverstage");
    assert.equal(draft.city?.value, "Brisbane");
    // LOWERCASE, matching what toCountryCode returns and what
    // services/sync/persist writes into Event.countryCode. A promoter draft
    // must land in the same case as an ingested event or the two will not
    // filter, group or compare together.
    assert.equal(draft.countryCode?.value, "au");
  });

  test("takes the event name from the largest non-fighter type", () => {
    assert.equal(draft.eventName?.value, "FIGHT NIGHT 12");
  });

  test("picks up a title fight from the caption beside it", () => {
    assert.equal(draft.bouts[0].titleFight, true);
  });

  test("returns leftovers instead of swallowing them", () => {
    // The promoter is the only one who knows whether a leftover line mattered.
    assert.ok(draft.unmatchedLines.includes("TICKETS ON SALE NOW"));
  });

  test("every value carries its source line", () => {
    assert.ok(draft.date!.source.includes("NOVEMBER"));
    assert.equal(draft.bouts[0].redName.source, "ETHAN COLE vs MARCO SILVA");
  });
});

describe("parsePoster — pasted text, no geometry", () => {
  // The path with no OCR provider at all. Must still work, degrading to
  // reading order.
  const lines = [
    "IRONFORGE FIGHT NIGHT 12",
    "ETHAN COLE vs MARCO SILVA",
    "JAYDEN BROOKS vs LEO RAMIREZ",
    "SATURDAY 14 NOVEMBER 2026",
    "Riverstage, Brisbane, Australia",
  ].map((t) => L(t));
  const draft = parsePoster(lines, NOW);

  test("still finds the bouts", () => {
    assert.equal(draft.bouts.length, 2);
  });

  test("falls back to reading order for the main event", () => {
    assert.equal(draft.bouts[0].redName.value, "ETHAN COLE");
    assert.equal(draft.bouts[0].mainEvent, true);
  });

  test("scores the event name LOWER without geometry", () => {
    // "the first line we did not otherwise use" is a much weaker claim than
    // "the largest type on the poster", and the review step must say so.
    const withGeometry = parsePoster(POSTER, NOW);
    assert.ok(draft.eventName!.confidence < withGeometry.eventName!.confidence);
  });
});

describe("parsePoster — stacked layout", () => {
  test("reads names split across lines with VS between them", () => {
    const draft = parsePoster(
      [L("ETHAN COLE", 0.08), L("VS", 0.02), L("MARCO SILVA", 0.08), L("14 NOVEMBER 2026")],
      NOW,
    );
    assert.equal(draft.bouts.length, 1);
    assert.equal(draft.bouts[0].redName.value, "ETHAN COLE");
    assert.equal(draft.bouts[0].blueName.value, "MARCO SILVA");
  });

  test("the separator line is consumed, not left over", () => {
    const draft = parsePoster([L("ETHAN COLE"), L("VS"), L("MARCO SILVA")], NOW);
    assert.ok(!draft.unmatchedLines.includes("VS"));
  });

  test("a fighter's name never also becomes the event name", () => {
    const draft = parsePoster([L("ETHAN COLE", 0.09), L("VS", 0.02), L("MARCO SILVA", 0.09)], NOW);
    const names = [draft.bouts[0].redName.value, draft.bouts[0].blueName.value];
    assert.ok(!names.includes(draft.eventName?.value ?? ""));
  });
});

describe("parsePoster — NEVER INVENT", () => {
  // The rule the whole module is built on. A field we cannot read stays null;
  // fixing an empty box takes five seconds, spotting a confidently-wrong one
  // takes a fan turning up on the wrong night.

  test("a poster with no date leaves the date null", () => {
    const draft = parsePoster([L("IRONFORGE FIGHT NIGHT"), L("ETHAN COLE vs MARCO SILVA")], NOW);
    assert.equal(draft.date, null);
  });

  test("an ambiguous date leaves it null rather than guessing", () => {
    const draft = parsePoster([L("FIGHT NIGHT"), L("03/04/2026")], NOW);
    assert.equal(draft.date, null);
    // And the line is handed back so the promoter can see what we skipped.
    assert.ok(draft.unmatchedLines.includes("03/04/2026"));
  });

  test("no venue vocabulary and no country means no venue", () => {
    const draft = parsePoster([L("FIGHT NIGHT 12"), L("BE THERE")], NOW);
    assert.equal(draft.venue, null);
    assert.equal(draft.countryCode, null);
  });

  test("an empty poster yields an empty draft, not a crash", () => {
    const draft = parsePoster([], NOW);
    assert.deepEqual(draft.bouts, []);
    assert.equal(draft.eventName, null);
    assert.equal(draft.date, null);
    assert.equal(draftCompleteness(draft), 0);
  });

  test("blank and whitespace-only lines are dropped", () => {
    const draft = parsePoster([L("   "), L(""), L("ETHAN COLE vs MARCO SILVA")], NOW);
    assert.equal(draft.bouts.length, 1);
    assert.deepEqual(draft.unmatchedLines, []);
  });
});

describe("parsePoster — what is and is not a fighter's name", () => {
  test("accepts names the Latin-only alphabet would drop", () => {
    // Þórir, Müller, D'Angelo, Silva-Costa are real fighters. A parser that
    // only accepts [A-Za-z] quietly loses a chunk of the roster.
    const draft = parsePoster([L("Þórir Guðmundsson vs Jean-Luc D'Angelo")], NOW);
    assert.equal(draft.bouts.length, 1);
    assert.equal(draft.bouts[0].redName.value, "Þórir Guðmundsson");
    assert.equal(draft.bouts[0].blueName.value, "Jean-Luc D'Angelo");
  });

  test("rejects poster furniture that happens to contain 'vs'", () => {
    const draft = parsePoster([L("TICKETS ON SALE vs SOLD OUT")], NOW);
    assert.equal(draft.bouts.length, 0);
  });

  test("rejects a line with digits as a name", () => {
    const draft = parsePoster([L("ROUND 1 vs ROUND 2")], NOW);
    assert.equal(draft.bouts.length, 0);
  });

  test("handles the abbreviated separator", () => {
    assert.equal(parsePoster([L("ETHAN COLE V MARCO SILVA")], NOW).bouts.length, 1);
    assert.equal(parsePoster([L("ETHAN COLE VERSUS MARCO SILVA")], NOW).bouts.length, 1);
  });
});

describe("draftCompleteness", () => {
  test("a full poster scores high", () => {
    assert.ok(draftCompleteness(parsePoster(POSTER, NOW)) >= 0.8);
  });

  test("a poster yielding only a name scores low", () => {
    // The signal that says "skip the review step and go straight to manual
    // entry" rather than parading an almost-empty result as extraction.
    const draft = parsePoster([{ text: "FIGHT NIGHT 12" }], NOW);
    assert.ok(draftCompleteness(draft) <= 0.2);
  });
});
