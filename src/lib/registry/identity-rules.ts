import { VIA_CONFIDENCE, type ResolutionVia } from "@/lib/entities/resolve";

// ════════════════════════════════════════════════════════════════════════════
//  IDENTITY DECISION RULES — pure. No database, no I/O, no framework.
//
//  These are the rules that decide whether two rows are the same human being.
//  They are separated from the queries that feed them so every one of them is
//  exhaustively testable without fixtures, and so the SAME rule governs an
//  ingest, a user signup and a backfill audit.
//
//  ── The rule that matters most ───────────────────────────────────────────
//  NEVER MERGE AUTOMATICALLY BELOW THE THRESHOLD, and never resolve on a name
//  alone. A display name is not an identifier: "Alex Volkanovski" and
//  "Alexander Volkanovski" are one person, while a boxer and an MMA fighter can
//  genuinely share a name. The old pipeline used `slugify(name)` as the primary
//  key of a human being, which gets BOTH of those wrong in opposite directions.
//
//  ── Corroboration, not similarity ────────────────────────────────────────
//  There is no fuzzy score to tune. A name match is a starting point; what
//  raises or lowers it is AGREEMENT ON FACTS that are hard to coincide:
//  birthdate first, then nationality. Two people with the same name and the same
//  date of birth are almost certainly one person; two with the same name and
//  provably different birthdates are certainly not, however similar the strings.
// ════════════════════════════════════════════════════════════════════════════

/** What the resolver concluded. Named for the caller's decision, not ours. */
export type IdentityOutcome =
  /** Act on it: link, attach, write. */
  | "MATCH_CONFIDENT"
  /** Plausible, not certain. Queue for review. NEVER merge on this. */
  | "MATCH_POSSIBLE"
  /** Nothing comparable. Create a provisional entry. */
  | "NO_MATCH"
  /** Two or more candidates are equally good. Refuse and queue — a tie is the
   *  one case where guessing is guaranteed to be wrong half the time. */
  | "AMBIGUOUS";

/**
 * At or above this, the system acts without a human.
 *
 * Set at the `alias` rung (0.95). Everything at or above it is an EXACT match on
 * something that identifies a person — an external id, their canonical name, a
 * registry alias. Everything below is an inference from a string, and inference
 * goes to a review queue.
 */
export const AUTO_LINK_THRESHOLD = VIA_CONFIDENCE.alias;

/**
 * Below this, a candidate is not worth a reviewer's time.
 *
 * Between the two thresholds is the review band. Under it the pair is dropped
 * silently — a queue nobody can finish is a queue nobody reads, and the whole
 * point of the review queue is that its contents are actionable.
 */
export const REVIEW_FLOOR = VIA_CONFIDENCE.initial;

/** The facts a candidate offers for corroboration. All optional. */
export interface IdentityFacts {
  birthDate?: Date | string | null;
  countryCode?: string | null;
  nationality?: string | null;
  /** (source, externalId) pairs already linked to this row. */
  externalIds?: { source: string; externalId: string }[];
}

export type Corroboration =
  /** A hard fact agrees. Promotes an inference to confident. */
  | "birthdate_match"
  | "nationality_match"
  /** A hard fact DISAGREES. Vetoes the match outright. */
  | "birthdate_conflict"
  /** Nothing comparable — the common case, and not evidence either way. */
  | "none";

const dayOf = (d: Date | string | null | undefined): string | null => {
  if (!d) return null;
  const date = d instanceof Date ? d : new Date(d);
  return Number.isNaN(date.getTime()) ? null : date.toISOString().slice(0, 10);
};

/** Normalised country, tolerating an ISO code on one side and a name on the other. */
const countryOf = (f: IdentityFacts): string | null => {
  const code = (f.countryCode ?? "").trim().toUpperCase();
  if (code) return code;
  const name = (f.nationality ?? "").trim().toUpperCase();
  return name || null;
};

/**
 * Compare the hard facts on two candidates.
 *
 * Birthdate outranks nationality, and a birthdate CONFLICT is checked before any
 * agreement: two fighters born on different days are different people no matter
 * how identical their names, and that veto has to fire even when the countries
 * also match.
 *
 * Absence is never evidence. Most imported rows have no birthdate at all, so
 * "no birthdate" must mean "cannot corroborate", never "does not match" — the
 * opposite reading would refuse almost every legitimate match in the database.
 */
export function corroborate(a: IdentityFacts, b: IdentityFacts): Corroboration {
  const [dayA, dayB] = [dayOf(a.birthDate), dayOf(b.birthDate)];
  if (dayA && dayB) return dayA === dayB ? "birthdate_match" : "birthdate_conflict";

  const [countryA, countryB] = [countryOf(a), countryOf(b)];
  if (countryA && countryB && countryA === countryB) return "nationality_match";

  return "none";
}

export interface Verdict {
  outcome: IdentityOutcome;
  confidence: number;
  /** Human-readable rationale, e.g. "name_exact + birthdate_match". */
  reason: string;
}

/**
 * Turn a ladder rung plus corroboration into a decision.
 *
 * The promotion and veto rules, stated:
 *
 *   • birthdate CONFLICT  → NO_MATCH, always. Overrides everything, including an
 *     exact name match. This is the only hard veto and it is the reason the
 *     resolver can afford to be generous about names elsewhere.
 *   • an EXACT identifier (external id, canonical name, alias) → confident on
 *     its own. It is already an identity claim, not an inference.
 *   • an INFERENCE (loose name, dropped surname, initials) + a birthdate match →
 *     promoted to confident. The birthdate is what makes it safe.
 *   • an inference + nationality only → stays POSSIBLE. Sharing a country is
 *     weak evidence: most fighters in a division share a handful of them.
 *   • anything below the review floor → NO_MATCH, and not even queued.
 */
export function decide(via: ResolutionVia, corroboration: Corroboration): Verdict {
  const base = VIA_CONFIDENCE[via] ?? 0;

  if (corroboration === "birthdate_conflict") {
    return {
      outcome: "NO_MATCH",
      confidence: 0,
      // Named explicitly because a reviewer seeing "these are obviously the same
      // name" needs to know the system had a reason, not a bug.
      reason: `${via} + birthdate_conflict (vetoed)`,
    };
  }

  if (base >= AUTO_LINK_THRESHOLD) {
    return { outcome: "MATCH_CONFIDENT", confidence: base, reason: via };
  }

  if (corroboration === "birthdate_match") {
    return {
      outcome: "MATCH_CONFIDENT",
      // Corroborated, but never claimed to be as certain as an external id.
      confidence: Math.min(0.97, base + 0.2),
      reason: `${via} + birthdate_match`,
    };
  }

  if (base < REVIEW_FLOOR) {
    return { outcome: "NO_MATCH", confidence: base, reason: `${via} below review floor` };
  }

  const bumped = corroboration === "nationality_match" ? Math.min(0.9, base + 0.05) : base;
  return {
    outcome: "MATCH_POSSIBLE",
    confidence: bumped,
    reason: corroboration === "none" ? via : `${via} + ${corroboration}`,
  };
}

/**
 * Demote a name-only match that crosses disciplines.
 *
 * The registry models a fighter as multi-discipline on purpose (`Fighter.sports`
 * is an array — Superlek fights Muay Thai and kickboxing), so a boxer and an MMA
 * fighter sharing a row is sometimes CORRECT and candidates are deliberately not
 * filtered by sport. But two different people sharing a common name across two
 * sports is also entirely normal, and the old pipeline merged them silently
 * because its key was `slugify(name)`.
 *
 * So a cross-discipline match survives only when something other than the name
 * says so: an external id, or an agreeing birthdate. A bare name match across
 * disciplines goes to review, where a human takes five seconds to answer a
 * question the system genuinely cannot.
 */
export function demoteAcrossSports(v: Verdict, sameSport: boolean, via: ResolutionVia): Verdict {
  if (sameSport || v.outcome !== "MATCH_CONFIDENT") return v;
  // An external id is an identity claim, not a name — it crosses sports freely.
  if (via === "external_id" || via === "registry_id") return v;
  if (v.reason.includes("birthdate_match")) return v;
  return {
    outcome: "MATCH_POSSIBLE",
    confidence: Math.min(v.confidence, 0.85),
    reason: `${v.reason} + sport_mismatch (needs review)`,
  };
}

/** Is this verdict strong enough to act on without a human? */
export const isActionable = (v: Verdict): boolean => v.outcome === "MATCH_CONFIDENT";

/** Should this pair be put in front of a reviewer? */
export const isReviewable = (v: Verdict): boolean =>
  (v.outcome === "MATCH_POSSIBLE" || v.outcome === "AMBIGUOUS") && v.confidence >= REVIEW_FLOOR;
