import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveDisciplines, competesIn, classifyDrift } from "@/lib/fighters/disciplines";
import type { DisciplineBout } from "@/lib/fighters/disciplines";

// Muay Thai holds 95 events and 852 bouts, and the fighter directory shows TEN
// fighters — because ONE's athletes were created by an MMA-classified ingest and
// nothing revisited them. Fighter.sport is a label written by whichever provider
// got there first; a fighter's disciplines are what they have actually competed in.

// `sport` here is the BOUT's ruleset mapped to a sport (Fight.ruleset), never
// the event's — see DisciplineBout.
const settled = (sport: string, n: number): DisciplineBout[] =>
  Array.from({ length: n }, () => ({ sport: sport as NonNullable<DisciplineBout["sport"]>, settled: true }));
const booked = (sport: string, n: number): DisciplineBout[] =>
  Array.from({ length: n }, () => ({ sport: sport as NonNullable<DisciplineBout["sport"]>, settled: false }));

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

// ── the persisted confidence tier ─────────────────────────────────────────
// Stored on Fighter so a consumer never re-derives to find out how much the
// graph is worth. Uncertainty is exposed, never hidden.

const withConf = (sport: string, n: number, conf: number | null): DisciplineBout[] =>
  Array.from({ length: n }, () => ({
    sport: sport as NonNullable<DisciplineBout["sport"]>,
    settled: true,
    rulesetConfidence: conf,
  }));

test("a ruleset STATED on the bout is HIGH", () => {
  const d = resolveDisciplines({ importedSport: "MMA", bouts: withConf("MUAY_THAI", 4, 1) });
  assert.equal(d.tier, "HIGH");
});

test("a ruleset DERIVED from a promotion or card is MEDIUM", () => {
  assert.equal(resolveDisciplines({ importedSport: null, bouts: withConf("MMA", 6, 0.9) }).tier, "MEDIUM");
  assert.equal(resolveDisciplines({ importedSport: null, bouts: withConf("JUDO", 6, 0.8) }).tier, "MEDIUM");
});

test("the STRONGEST evidence sets the tier — volume must not dilute a fact", () => {
  // One stated bout beats ten derived ones. Averaging would let a pile of weak
  // evidence bury a thing we actually know.
  const d = resolveDisciplines({
    importedSport: null,
    bouts: [...withConf("MUAY_THAI", 1, 1), ...withConf("MUAY_THAI", 10, 0.8)],
  });
  assert.equal(d.tier, "HIGH");
});

test("a label with no bout behind it is LOW, and says so", () => {
  const d = resolveDisciplines({ importedSport: "BOXING", bouts: [] });
  assert.equal(d.tier, "LOW");
  assert.equal(d.fromImportOnly, true);
});

test("no label and no bouts is UNKNOWN — nothing is claimed", () => {
  assert.equal(resolveDisciplines({ importedSport: null, bouts: [] }).tier, "UNKNOWN");
});

test("the tier describes the PRIMARY discipline, not the best bout anywhere", () => {
  // Stated kickboxing evidence must not make a derived Muay Thai primary read HIGH.
  const d = resolveDisciplines({
    importedSport: null,
    bouts: [...withConf("MUAY_THAI", 8, 0.8), ...withConf("KICKBOXING", 2, 1)],
  });
  assert.equal(d.primarySport, "MUAY_THAI");
  assert.equal(d.tier, "MEDIUM");
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
  // moment a bout's ruleset carries it.
  const d = resolveDisciplines({ importedSport: "MMA", bouts: settled("LETHWEI", 4) });
  assert.equal(d.primarySport, "LETHWEI");
});

test("a bout whose RULESET is unknown contributes nothing", () => {
  // The substitution this rewrite removed: an UNKNOWN bout used to fall back to
  // its card's sport, which is how a Muay Thai specialist's mixed-card bouts
  // read as MMA. It must now be silent evidence, not wrong evidence.
  const d = resolveDisciplines({
    importedSport: "MMA",
    bouts: [
      ...settled("MUAY_THAI", 3),
      { sport: null, settled: true },
      { sport: null, settled: true },
    ],
  });
  assert.equal(d.primarySport, "MUAY_THAI");
  assert.deepEqual(d.sports, ["MUAY_THAI"]);
  // Confidence counts only bouts we can read, so it is not diluted by ignorance.
  assert.equal(d.confidence, 1);
});

test("a fighter whose every bout is UNKNOWN falls back to the label, marked", () => {
  const d = resolveDisciplines({
    importedSport: "MMA",
    bouts: [{ sport: null, settled: true }, { sport: null, settled: true }],
  });
  assert.equal(d.primarySport, "MMA");
  assert.equal(d.fromImportOnly, true);
  assert.equal(d.confidence, 0);
});
