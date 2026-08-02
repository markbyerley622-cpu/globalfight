import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveDisciplines, competesIn, classifyDrift } from "@/lib/fighters/disciplines";
import type { DisciplineBout } from "@/lib/fighters/disciplines";

// Muay Thai holds 95 events and 852 bouts, and the fighter directory shows TEN
// fighters — because ONE's athletes were created by an MMA-classified ingest and
// nothing revisited them. Fighter.sport is a label written by whichever provider
// got there first; a fighter's disciplines are what they have actually competed in.

const settled = (sport: string, n: number): DisciplineBout[] =>
  Array.from({ length: n }, () => ({ sport: sport as DisciplineBout["sport"], settled: true }));
const booked = (sport: string, n: number): DisciplineBout[] =>
  Array.from({ length: n }, () => ({ sport: sport as DisciplineBout["sport"], settled: false }));

// ── the bug ───────────────────────────────────────────────────────────────

test("THE BUG: an MMA-labelled fighter with only Muay Thai bouts is Muay Thai", () => {
  const d = resolveDisciplines({ importedSport: "MMA", bouts: settled("MUAY_THAI", 12) });
  assert.equal(d.primarySport, "MUAY_THAI");
  assert.deepEqual(d.sports, ["MUAY_THAI"]);
  assert.equal(d.confidence, 1);
  assert.equal(classifyDrift("MMA", d), "contradicted");
});

test("the fighter is findable under the sport they actually fight", () => {
  const d = resolveDisciplines({ importedSport: "MMA", bouts: settled("MUAY_THAI", 5) });
  assert.equal(competesIn(d, "MUAY_THAI"), true);
  assert.equal(competesIn(d, "MMA"), false);
});

// ── multi-discipline, which the single enum cannot express ────────────────

test("a crossover athlete keeps EVERY discipline, primary first", () => {
  const d = resolveDisciplines({
    importedSport: "MUAY_THAI",
    bouts: [...settled("MUAY_THAI", 20), ...settled("KICKBOXING", 6), ...settled("MMA", 2)],
  });
  assert.equal(d.primarySport, "MUAY_THAI");
  assert.deepEqual(d.sports, ["MUAY_THAI", "KICKBOXING", "MMA"]);
  assert.equal(competesIn(d, "KICKBOXING"), true);
  assert.equal(competesIn(d, "MMA"), true);
});

test("confidence is the share of settled bouts in the primary, so crossover scores lower", () => {
  const pure = resolveDisciplines({ importedSport: "MUAY_THAI", bouts: settled("MUAY_THAI", 10) });
  const split = resolveDisciplines({
    importedSport: "MUAY_THAI",
    bouts: [...settled("MUAY_THAI", 6), ...settled("KICKBOXING", 4)],
  });
  assert.equal(pure.confidence, 1);
  assert.equal(split.confidence, 0.6);
});

test("the imported label is respected as a SECONDARY discipline, not erased", () => {
  const d = resolveDisciplines({
    importedSport: "MMA",
    bouts: [...settled("MUAY_THAI", 9), ...settled("MMA", 2)],
  });
  assert.equal(d.primarySport, "MUAY_THAI");
  assert.equal(competesIn(d, "MMA"), true);
  assert.equal(classifyDrift("MMA", d), "secondary");
});

// ── evidence strength ─────────────────────────────────────────────────────

test("settled bouts outrank booked ones when choosing the primary", () => {
  const d = resolveDisciplines({
    importedSport: null,
    bouts: [...settled("BOXING", 3), ...booked("MMA", 10)],
  });
  assert.equal(d.primarySport, "BOXING");
  // The booking is still recorded — it is real, just not history yet.
  assert.equal(competesIn(d, "MMA"), true);
  assert.equal(d.evidence.find((e) => e.sport === "MMA")?.source, "booked");
});

test("a debut with no settled bout has no confidence yet", () => {
  const d = resolveDisciplines({ importedSport: "MMA", bouts: booked("MMA", 1) });
  assert.equal(d.primarySport, "MMA");
  assert.equal(d.confidence, 0);
  assert.equal(d.fromImportOnly, false);
});

// ── no history ────────────────────────────────────────────────────────────

test("with no bouts the import label is used but MARKED as unverified", () => {
  const d = resolveDisciplines({ importedSport: "BOXING", bouts: [] });
  assert.equal(d.primarySport, "BOXING");
  assert.equal(d.confidence, 0);
  assert.equal(d.fromImportOnly, true);
  assert.equal(classifyDrift("BOXING", d), "unverifiable");
});

test("no bouts and no label yields nothing — never a guessed sport", () => {
  const d = resolveDisciplines({ importedSport: null, bouts: [] });
  assert.equal(d.primarySport, null);
  assert.deepEqual(d.sports, []);
});

// ── determinism ───────────────────────────────────────────────────────────

test("a tie breaks toward the imported label rather than alphabetically", () => {
  const d = resolveDisciplines({
    importedSport: "MMA",
    bouts: [...settled("MMA", 5), ...settled("BOXING", 5)],
  });
  assert.equal(d.primarySport, "MMA");
});

test("a tie with an unrelated label is still deterministic", () => {
  const a = resolveDisciplines({ importedSport: "JUDO", bouts: [...settled("MMA", 5), ...settled("BOXING", 5)] });
  const b = resolveDisciplines({ importedSport: "JUDO", bouts: [...settled("BOXING", 5), ...settled("MMA", 5)] });
  assert.equal(a.primarySport, b.primarySport);
  assert.deepEqual(a.sports, b.sports);
});

test("classifyDrift separates the repairable from the ambiguous", () => {
  const mt = resolveDisciplines({ importedSport: "MMA", bouts: settled("MUAY_THAI", 8) });
  assert.equal(classifyDrift("MUAY_THAI", mt), "agrees");
  assert.equal(classifyDrift("MMA", mt), "contradicted");

  const multi = resolveDisciplines({
    importedSport: "JUDO",
    bouts: [...settled("MUAY_THAI", 5), ...settled("KICKBOXING", 3)],
  });
  assert.equal(classifyDrift("JUDO", multi), "conflicting");
});

test("a sport nobody has coded for still resolves — extensible by construction", () => {
  // Nothing in the resolver enumerates sports, so a future discipline works the
  // moment an event carries it.
  const d = resolveDisciplines({
    importedSport: "MMA",
    bouts: settled("LETHWEI" as unknown as DisciplineBout["sport"], 4),
  });
  assert.equal(d.primarySport, "LETHWEI");
});
