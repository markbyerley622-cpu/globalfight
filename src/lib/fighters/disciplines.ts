// ════════════════════════════════════════════════════════════════════════════
//  What does this fighter actually COMPETE IN? ONE definition, PURE.
//
//  Fighter.sport is a single enum written by whichever provider created the row
//  first, and it is a LABEL, not a fact. The consequence is measurable: Muay
//  Thai holds 95 events and 852 bouts and the fighter directory shows TEN
//  fighters, because ONE's athletes were created by an MMA-classified ingest and
//  nothing ever revisited them. The coverage exists; the graph is wrong.
//
//  ── DISCIPLINE IS DERIVED FROM COMPETITION, NOT FROM AN IMPORT ────────────
//
//  A fighter's disciplines are the sports they have actually been booked in —
//  the sport of each event they have a settled bout on. That is a fact we hold
//  and can defend. The imported label is a HINT, used only when there is no
//  competition history to read.
//
//  ── AND A FIGHTER IS NOT ONE SPORT ───────────────────────────────────────
//
//  Superlek fights Muay Thai and kickboxing. Usman Nurmagomedov's teammates
//  fight MMA and sambo. Forcing a single enum is what created the bug: the row
//  can only be right about one of them, so it is wrong about the rest. This
//  returns a PRIMARY plus the full set, and every consumer that filters by sport
//  should ask "does this fighter compete in X", never "is fighter.sport === X".
//
//  Extensible by construction: nothing here enumerates sports. Karate Combat,
//  Lethwei, Sanda and Savate become disciplines the moment an event carries
//  them, with no change to this file.
// ════════════════════════════════════════════════════════════════════════════

import type { Sport } from "@/lib/types";

/** Where a discipline claim came from, weakest last. */
export type DisciplineSource =
  /** A settled bout on an event of that sport. The only strong evidence. */
  | "competition"
  /** A scheduled (not yet fought) bout. Real, but not yet history. */
  | "booked"
  /** The provider's label on the fighter row. A hint, never a conclusion. */
  | "import";

export interface DisciplineEvidence {
  sport: Sport;
  /** Settled bouts on events of this sport. */
  settled: number;
  /** Scheduled bouts — counted separately so a debut is visible but not decisive. */
  booked: number;
  source: DisciplineSource;
}

export interface ResolvedDisciplines {
  /** The discipline this fighter is most defined by, or null when unknown. */
  primarySport: Sport | null;
  /** Every discipline they have competed or are booked in, primary first. */
  sports: Sport[];
  /**
   * 0–1. The share of settled bouts sitting in the primary discipline, so a
   * pure Muay Thai fighter scores 1 and a genuine crossover athlete scores
   * lower — which is correct: the PRIMARY is less certain for them.
   * 0 when the only evidence is an import label.
   */
  confidence: number;
  evidence: DisciplineEvidence[];
  /** True when nothing but the import label was available. */
  fromImportOnly: boolean;
  /**
   * How much the whole graph is worth, from the ruleset confidence of the bouts
   * behind the PRIMARY discipline. Persisted so uncertainty is visible without
   * anyone re-deriving it — never hidden.
   */
  tier: DisciplineTier;
}

export interface DisciplineBout {
  /**
   * The discipline this BOUT was contested under — from Fight.ruleset, mapped
   * to a Sport. Pass null when the bout's ruleset is UNKNOWN.
   *
   * NOT the event's sport. Event.sport is the CARD's majority ruleset and is
   * false for most bouts on a mixed card, which is what proposed reclassifying
   * Superlek from Muay Thai to MMA at confidence 1.00. A bout whose ruleset we
   * do not know contributes NOTHING rather than contributing its card's label.
   */
  sport: Sport | null;
  /** A decided bout. Scheduled bouts are weaker evidence. */
  settled: boolean;
  /**
   * Fight.rulesetConfidence — how the bout's ruleset was established:
   * 1 stated on the bout · 0.9 single-ruleset promotion · 0.8 event sport.
   *
   * Carried through so the fighter's stored tier can say WHY it is worth what
   * it is worth, rather than a consumer having to re-open the Fight table to
   * find out. Null when the bout has no ruleset.
   */
  rulesetConfidence?: number | null;
}

/**
 * How much a stored discipline graph is worth. Mirrors the Prisma enum; kept as
 * a string union here so this module stays pure and client-safe.
 */
export type DisciplineTier = "HIGH" | "MEDIUM" | "LOW" | "UNKNOWN";

/** A stated ruleset. Below this the evidence is derived rather than read. */
const STATED = 1;

/**
 * Resolve a fighter's disciplines from their bouts, falling back to the
 * imported label only when there are none.
 *
 * Deterministic and total: it never throws, never guesses a sport that has no
 * bout behind it, and returns a stable order (settled desc, then booked desc,
 * then alphabetical) so two runs over the same data agree.
 */
export function resolveDisciplines(input: {
  importedSport: Sport | null | undefined;
  bouts: DisciplineBout[];
}): ResolvedDisciplines {
  const tally = new Map<Sport, { settled: number; booked: number; bestConfidence: number }>();
  for (const b of input.bouts) {
    // An UNKNOWN ruleset is not evidence. Counting it under the card's sport is
    // precisely the substitution this rewrite removed.
    if (!b.sport) continue;
    const t = tally.get(b.sport) ?? { settled: 0, booked: 0, bestConfidence: 0 };
    if (b.settled) t.settled += 1;
    else t.booked += 1;
    // The STRONGEST evidence for this discipline, not the average: one bout
    // whose ruleset the source stated is a firmer basis than ten derived ones,
    // and averaging would let volume dilute a fact.
    t.bestConfidence = Math.max(t.bestConfidence, b.rulesetConfidence ?? 0);
    tally.set(b.sport, t);
  }

  // No competition history at all: the import label is all we have. It is
  // reported with confidence 0 and marked, so a caller can choose to distrust it.
  if (tally.size === 0) {
    if (!input.importedSport) {
      return {
        primarySport: null, sports: [], confidence: 0, evidence: [],
        fromImportOnly: true, tier: "UNKNOWN",
      };
    }
    return {
      primarySport: input.importedSport,
      sports: [input.importedSport],
      confidence: 0,
      evidence: [{ sport: input.importedSport, settled: 0, booked: 0, source: "import" }],
      fromImportOnly: true,
      // A label with no bout behind it. Stated as LOW rather than dressed up.
      tier: "LOW",
    };
  }

  const evidence: DisciplineEvidence[] = [...tally.entries()]
    .map(([sport, t]) => ({
      sport,
      settled: t.settled,
      booked: t.booked,
      source: (t.settled > 0 ? "competition" : "booked") as DisciplineSource,
    }))
    .sort((a, b) =>
      b.settled - a.settled ||
      b.booked - a.booked ||
      a.sport.localeCompare(b.sport),
    );

  const totalSettled = evidence.reduce((n, e) => n + e.settled, 0);

  // The primary is the discipline with the most SETTLED bouts. A tie is broken
  // toward the imported label when it is among the tied set — the provider knew
  // something, and preferring it over alphabetical order is the less arbitrary
  // choice — and otherwise by the sort above.
  let primary = evidence[0];
  if (input.importedSport) {
    const top = evidence[0].settled;
    const tied = evidence.filter((e) => e.settled === top);
    const importedTied = tied.find((e) => e.sport === input.importedSport);
    if (tied.length > 1 && importedTied) primary = importedTied;
  }

  const sports = [primary.sport, ...evidence.filter((e) => e.sport !== primary.sport).map((e) => e.sport)];

  // The tier reflects HOW the primary discipline's ruleset was established —
  // read from the source, or derived from a promotion/card. It is deliberately
  // about provenance, not about volume: a fighter with one stated Muay Thai
  // bout is HIGH, because we KNOW that bout's rules.
  const best = tally.get(primary.sport)?.bestConfidence ?? 0;
  const tier: DisciplineTier = best >= STATED ? "HIGH" : best > 0 ? "MEDIUM" : "LOW";

  return {
    primarySport: primary.sport,
    sports,
    // Share of settled bouts in the primary. With no settled bouts (booked only)
    // there is nothing to be confident about yet.
    confidence: totalSettled > 0 ? primary.settled / totalSettled : 0,
    evidence,
    fromImportOnly: false,
    tier,
  };
}

/** Does this fighter compete in `sport`? The question every filter should ask. */
export function competesIn(d: ResolvedDisciplines, sport: Sport): boolean {
  return d.sports.includes(sport);
}

export type DriftKind =
  /** The label matches the primary discipline. Nothing to do. */
  | "agrees"
  /** The label is one of their disciplines, but not the main one. */
  | "secondary"
  /** The label is a sport they have NEVER competed in. The real bug. */
  | "contradicted"
  /** Multiple disciplines, and the label names none of them. */
  | "conflicting"
  /** No bouts — the label is unverifiable either way. */
  | "unverifiable";

/**
 * How the imported label stands against the competition history.
 *
 * Separated from the resolution itself because the two answer different
 * questions: `resolveDisciplines` says what is true, this says how wrong the
 * stored row is — which is what decides whether a repair is safe to automate.
 */
export function classifyDrift(
  importedSport: Sport | null | undefined,
  d: ResolvedDisciplines,
): DriftKind {
  if (d.fromImportOnly || d.sports.length === 0) return "unverifiable";
  if (!importedSport) return "contradicted";
  if (importedSport === d.primarySport) return "agrees";
  if (d.sports.includes(importedSport)) return "secondary";
  return d.sports.length > 1 ? "conflicting" : "contradicted";
}
