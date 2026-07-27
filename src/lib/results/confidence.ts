import { voiceKey, sourceProfileFor, type SourceKind } from "./sources";
import type { Corner, Method, Outcome } from "./extract";

// ════════════════════════════════════════════════════════════════════════════
//  Many pieces of evidence → one scored candidate, or a declared conflict. PURE.
//
//  The engine answers three separate questions and never conflates them:
//
//    1. WHAT do the sources say?      → group evidence by the outcome it asserts
//    2. HOW MUCH do we trust that?    → independent voices × reliability × quality
//    3. IS THERE DISAGREEMENT?        → a second, credible reading is a CONFLICT
//
//  Question 3 is the one that protects settlement. A candidate with 0.9 support and
//  a credible dissenter is not a 0.9 candidate — it is a conflict, and it goes to a
//  human regardless of the number. Averaging the disagreement away is exactly how an
//  automated pipeline publishes a wrong result confidently.
//
//  Every output carries `reasons`, because "why do we believe this" has to be
//  answerable in the operator queue without re-deriving it.
// ════════════════════════════════════════════════════════════════════════════

export interface EvidenceInput {
  /** Where it came from — decides reliability and voice identity. */
  sourceUrl: string | null;
  /** Override for sources with no URL (Wikipedia sync, an operator). */
  sourceKind?: SourceKind;
  outcome: Outcome;
  winner: Corner | null;
  method: Method | null;
  round: number | null;
  /** Extraction quality from lib/results/extract. */
  quality: number;
  /** When the source published. Later reports supersede earlier ones on detail. */
  observedAt?: Date | null;
}

export type CandidateStatus = "VERIFIED" | "PENDING_REVIEW" | "CONFLICTED" | "INCONCLUSIVE";

export interface Candidate {
  outcome: Outcome;
  winner: Corner | null;
  method: Method | null;
  round: number | null;
  /** 0..1 */
  confidence: number;
  status: CandidateStatus;
  /** Distinct independent voices supporting this reading. */
  agreeing: number;
  /** Distinct independent voices supporting a DIFFERENT reading. */
  disagreeing: number;
  reasons: string[];
}

/**
 * Thresholds. Configurable because the right values are an operational judgement
 * that will change as source coverage grows — not a constant to be buried.
 *
 * `autoPublish` is deliberately high AND paired with `autoPublishVoices`: a single
 * very reliable source is not enough on its own. Wikipedia is the one exception,
 * handled by the caller, because it is already the authoritative path today.
 */
export interface Thresholds {
  autoPublish: number;
  autoPublishVoices: number;
  review: number;
}

export const DEFAULT_THRESHOLDS: Thresholds = {
  autoPublish: 0.85,
  autoPublishVoices: 2,
  review: 0.45,
};

/** The identity of a READING — what actually has to agree. */
const readingKey = (e: { outcome: Outcome; winner: Corner | null }) =>
  e.outcome === "WIN" ? `WIN:${e.winner}` : e.outcome;

/**
 * Combine independent observations — noisy-OR.
 *
 *   support = 1 − Π(1 − strengthᵢ)
 *
 * i.e. "the chance that at least one of these sources is right about this", which is
 * the correct shape for independent evidence pointing the same way.
 *
 * This replaced a multiplicative "agreement factor", which was wrong in a way the
 * tests caught: multiplying a factor ≤1 by the best single source's strength CAPPED
 * total support at that one source. Two ESPN-grade outlets agreeing could never
 * exceed 0.60 against a 0.85 bar, so nothing outside Wikipedia could ever verify and
 * the whole point of the pipeline — faster results — was unreachable.
 *
 * Noisy-OR has the property that matters: corroboration RAISES confidence above any
 * single source, while a weak source adds almost nothing. Two majors at 0.675 each
 * reach 0.89; five syndicated aggregators are one voice and stay at 0.28.
 *
 * `strengths` must already be one entry per DISTINCT VOICE, or a source quoted twice
 * would corroborate itself.
 */
function combineIndependent(strengths: number[]): number {
  return 1 - strengths.reduce((acc, s) => acc * (1 - Math.max(0, Math.min(0.99, s))), 1);
}

export function scoreCandidate(
  evidence: EvidenceInput[],
  thresholds: Thresholds = DEFAULT_THRESHOLDS,
): Candidate | null {
  if (!evidence.length) return null;

  // ── group by the reading asserted ────────────────────────────────────────
  const groups = new Map<string, EvidenceInput[]>();
  for (const e of evidence) {
    const k = readingKey(e);
    groups.set(k, [...(groups.get(k) ?? []), e]);
  }

  /** The voice an observation speaks with. Syndicated copies share one. */
  const voiceIdOf = (i: EvidenceInput) =>
    i.sourceKind ? `kind:${i.sourceKind}` : voiceKey(i.sourceUrl);

  const strengthOf = (i: EvidenceInput) => {
    // An explicit kind wins over URL classification: the Wikipedia sync and an
    // operator entry have no article URL to look up.
    const reliability = i.sourceKind
      ? kindReliability(i.sourceKind)
      : sourceProfileFor(i.sourceUrl).reliability;
    return reliability * Math.max(0.1, Math.min(1, i.quality));
  };

  /**
   * One strength per distinct voice — the BEST observation that voice made.
   *
   * Collapsing per voice before combining is what stops an outlet corroborating
   * itself across a report and its follow-up.
   */
  const strengthsPerVoice = (items: EvidenceInput[]): number[] => {
    const best = new Map<string, number>();
    for (const i of items) {
      const id = voiceIdOf(i);
      best.set(id, Math.max(best.get(id) ?? 0, strengthOf(i)));
    }
    return [...best.values()];
  };

  const scored = [...groups.entries()]
    .map(([key, items]) => {
      const strengths = strengthsPerVoice(items);
      return {
        key,
        items,
        voices: strengths.length,
        strength: Math.max(...strengths),
        support: combineIndependent(strengths),
      };
    })
    .sort((a, b) => b.support - a.support);

  const top = scored[0];
  const rival = scored[1];

  const reasons: string[] = [];
  reasons.push(
    `${top.voices} independent ${top.voices === 1 ? "voice" : "voices"} support ${top.key}`,
  );

  // ── the winning reading's detail ─────────────────────────────────────────
  // Detail (method, round) is taken by CONSENSUS within the group, not from the
  // strongest single source: a wire report is often first and thinnest, and the
  // follow-ups carry the round.
  const method = modeOf(top.items.map((i) => i.method).filter((m): m is Method => !!m));
  const round = modeOf(top.items.map((i) => i.round).filter((r): r is number => !!r));
  const winner = top.items.find((i) => i.winner)?.winner ?? null;
  const outcome = top.items[0].outcome;

  if (method) reasons.push(`Method agreed as ${method}`);
  else reasons.push("No method stated by any source");
  if (round) reasons.push(`Round agreed as ${round}`);

  // Detail disagreement inside an otherwise-agreeing group is worth flagging but is
  // not a conflict about the RESULT: who won is what settles a prediction.
  const methodSpread = new Set(top.items.map((i) => i.method).filter(Boolean)).size;
  if (methodSpread > 1) reasons.push(`Sources disagree on method (${methodSpread} versions) — detail needs review`);

  let confidence = top.support;
  let status: CandidateStatus;

  // ── CONFLICT: a credible second reading ─────────────────────────────────
  // The bar for "credible" is deliberately low. A dissenter only has to be
  // non-trivial to force a human, because the cost of being wrong is settlement.
  const rivalCredible = !!rival && rival.support >= 0.25;
  if (rivalCredible) {
    reasons.unshift(
      `CONFLICT: ${rival.voices} ${rival.voices === 1 ? "voice" : "voices"} say ${rival.key} instead`,
    );
    // The number is reported honestly rather than zeroed — an operator wants to see
    // that one side is much stronger — but the STATUS is what gates settlement.
    confidence = Math.min(confidence, 0.6);
    status = "CONFLICTED";
  } else if (confidence >= thresholds.autoPublish && top.voices >= thresholds.autoPublishVoices) {
    status = "VERIFIED";
    reasons.push(`Meets auto-publish (≥${thresholds.autoPublish} with ≥${thresholds.autoPublishVoices} voices)`);
  } else if (confidence >= thresholds.review) {
    status = "PENDING_REVIEW";
    reasons.push(
      top.voices < thresholds.autoPublishVoices
        ? `Only ${top.voices} independent ${top.voices === 1 ? "voice" : "voices"} — needs a second`
        : `Below auto-publish (${confidence.toFixed(2)} < ${thresholds.autoPublish})`,
    );
  } else {
    status = "INCONCLUSIVE";
    reasons.push(`Too weak to act on (${confidence.toFixed(2)} < ${thresholds.review})`);
  }

  if (methodSpread > 1 && status === "VERIFIED") {
    // Who won is verified; HOW is not. Publishing a contested method as fact would
    // put a wrong stoppage round on the bout page.
    status = "PENDING_REVIEW";
    reasons.push("Winner is clear but the method is contested — held for review");
  }

  return {
    outcome,
    winner,
    method,
    round,
    confidence: Math.round(Math.max(0, Math.min(1, confidence)) * 100) / 100,
    status,
    agreeing: top.voices,
    disagreeing: rival?.voices ?? 0,
    reasons,
  };
}

/** Reliability for an explicit source kind (no URL to classify). */
function kindReliability(kind: SourceKind): number {
  switch (kind) {
    case "WIKIPEDIA": return 0.95;
    case "OFFICIAL": return 0.9;
    case "MAJOR": return 0.75;
    case "TRADE": return 0.6;
    case "AGGREGATOR": return 0.35;
    default: return 0.25;
  }
}

/** Most common value; ties resolve to the first seen, which is the earliest report. */
function modeOf<T extends string | number>(values: T[]): T | null {
  if (!values.length) return null;
  const counts = new Map<T, number>();
  for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1);
  let best: T = values[0];
  let bestN = 0;
  for (const [v, n] of counts) {
    if (n > bestN) { best = v; bestN = n; }
  }
  return best;
}
