// ════════════════════════════════════════════════════════════════════════════
//  Which SPORT is this card? Read it off the bouts. ONE definition, PURE.
//
//  Every ingest path pinned an event's sport to a constant configured per
//  PROMOTION, which is only correct for promotions that run one ruleset. ONE
//  Championship runs four, and the consequence is the whole reason Muay Thai
//  coverage looks thin:
//
//    ONE Friday Fights (a.k.a. ONE Lumpinee) is ONE's Muay Thai and kickboxing
//    series at Lumpinee Boxing Stadium. There are ~250 of these cards. Every one
//    of them was ingested as sport: "MMA", because the year-page source that
//    reads them is configured `sport: "MMA"` for ONE as a whole.
//
//  So the platform holds a large Muay Thai corpus filed under the wrong sport,
//  and the fix is not another scraper — it is reading a field already fetched.
//
//  ── The signal ────────────────────────────────────────────────────────────
//
//  Wikipedia's ONE results tables state the ruleset PER BOUT, inside the weight
//  class: "Featherweight Muay Thai", "Women's Atomweight Kickboxing",
//  "Bantamweight MMA". Verified on ONE Friday Fights 46 (Tawanchai vs Superbon,
//  Lumpinee, 2023-12-22), whose table columns are Weight class / Method / Round /
//  Time / Notes.
//
//  That makes the card's sport DERIVABLE rather than assumed. Nothing here
//  guesses: a bout whose weight class names no ruleset contributes nothing, and
//  a card where no bout names one keeps the promotion's configured default.
// ════════════════════════════════════════════════════════════════════════════

import type { Sport } from "@/lib/types";
import type { Ruleset } from "@prisma/client";

// ════════════════════════════════════════════════════════════════════════════
//  THE CANONICAL RULESET MAPPING. Every provider goes through this.
//
//  Fight.ruleset is now a first-class column and the authority for fighter
//  discipline; Event.sport is contextual metadata about the CARD. Any provider
//  that classified a bout from its event was producing the Superlek bug — a
//  Muay Thai world champion proposed for reclassification to MMA at confidence
//  1.00, because his bouts sit on mixed ONE cards.
//
//  A ruleset is READ or it is UNKNOWN. It is never inferred here.
// ════════════════════════════════════════════════════════════════════════════

/** How much a stated ruleset is worth, by where it came from. */
export const RULESET_CONFIDENCE = {
  /** The source named the ruleset on the bout itself ("Featherweight Muay Thai"). */
  stated: 1,
  /**
   * Derived from a promotion that runs exactly one ruleset (UFC is MMA, GLORY is
   * kickboxing). Stronger than the event-sport derivation because it is a fact
   * about the ORGANISATION rather than about one card's billing, but still a
   * step removed from the bout, so a stated value supersedes it.
   */
  singleRulesetPromotion: 0.9,
  /**
   * Derived from the EVENT's sport, and only where that sport is one no
   * multi-ruleset promotion uses (a World Judo Championship is judo throughout).
   * The weakest of the three, because it reads a card's billing rather than a
   * fact about the organisation — so a promotion or a stated value supersedes it.
   */
  singleRulesetSport: 0.8,
} as const;

/**
 * A ruleset phrase → the enum. Returns null when nothing is named, so the
 * caller stores UNKNOWN rather than a default.
 *
 * Order matters: "submission grappling" before "grappling", "muay thai" before
 * both "thai" and "boxing", and bare "mma" last.
 */
export function toRuleset(label: string | null | undefined): Ruleset | null {
  if (!label) return null;
  const s = label.toLowerCase();
  if (/\bmuay\s*thai\b|\bthai\s*boxing\b/.test(s)) return "MUAY_THAI";
  if (/\blethwei\b/.test(s)) return "LETHWEI";
  if (/\bsanda\b|\bsan\s*shou\b/.test(s)) return "SANDA";
  if (/\bsavate\b/.test(s)) return "SAVATE";
  if (/\bkickboxing\b|\bk-?1\b/.test(s)) return "KICKBOXING";
  if (/\bkarate\b/.test(s)) return "KARATE";
  if (/\bbare[\s-]?knuckle\b/.test(s)) return "BARE_KNUCKLE";
  if (/\bsubmission\s+grappling\b|\bno[\s-]?gi\b|\bgrappling\b/.test(s)) return "SUBMISSION_GRAPPLING";
  if (/\bjiu[\s-]?jitsu\b|\bbjj\b/.test(s)) return "BJJ";
  if (/\bcombat\s+sambo\b/.test(s)) return "COMBAT_SAMBO";
  if (/\bsambo\b/.test(s)) return "SAMBO";
  if (/\bfreestyle\b|\bgreco[\s-]?roman\b|\bwrestling\b/.test(s)) return "WRESTLING";
  if (/\bjudo\b/.test(s)) return "JUDO";
  if (/\btaekwondo\b/.test(s)) return "TAEKWONDO";
  if (/\bboxing\b/.test(s)) return "BOXING";
  if (/\bmma\b|\bmixed\s+martial\s+arts\b/.test(s)) return "MMA";
  return null;
}

/**
 * A Ruleset → the Sport a fighter is credited with for competing under it.
 *
 * Mostly one-to-one. The interesting cases are the ones where the ruleset space
 * is deliberately wider than the sport space:
 *   • SUBMISSION_GRAPPLING is scored differently from gi BJJ but a competitor
 *     belongs in the same directory, so both credit BJJ;
 *   • KARATE / LETHWEI / SANDA / SAVATE have no Sport yet — they return null,
 *     which keeps the bout out of every directory rather than filing it under a
 *     sport it is not. Adding one later is a line here, not a migration.
 */
export function rulesetToSport(ruleset: Ruleset | null | undefined): Sport | null {
  switch (ruleset) {
    case "MMA": return "MMA";
    case "BOXING": return "BOXING";
    case "MUAY_THAI": return "MUAY_THAI";
    case "KICKBOXING": return "KICKBOXING";
    case "BARE_KNUCKLE": return "BARE_KNUCKLE";
    case "BJJ": return "BJJ";
    case "SUBMISSION_GRAPPLING": return "BJJ_NOGI";
    case "WRESTLING": return "WRESTLING";
    case "JUDO": return "JUDO";
    case "SAMBO": return "SAMBO";
    case "COMBAT_SAMBO": return "COMBAT_SAMBO";
    case "TAEKWONDO": return "TAEKWONDO";
    // No Sport for these yet — null keeps them out of every directory rather
    // than misfiling them.
    case "KARATE":
    case "LETHWEI":
    case "SANDA":
    case "SAVATE":
    case "UNKNOWN":
    default:
      return null;
  }
}

/**
 * A promotion's Sport → the ruleset every one of its bouts is contested under,
 * or null when the promotion runs MORE THAN ONE and the card cannot answer for
 * the bout.
 *
 * This is the ONLY legitimate use of event-level data for bout classification,
 * and it is legitimate precisely because it is conditional: a GLORY card is
 * kickboxing throughout, so the event tells us the bout's rules. A ONE card
 * does not, and returns null so the bout stays UNKNOWN until a source states it.
 */
export function rulesetFromSingleRulesetSport(sport: Sport | null | undefined): Ruleset | null {
  switch (sport) {
    case "BOXING": return "BOXING";
    case "KICKBOXING": return "KICKBOXING";
    case "MUAY_THAI": return "MUAY_THAI";
    case "BARE_KNUCKLE": return "BARE_KNUCKLE";
    case "WRESTLING": return "WRESTLING";
    case "JUDO": return "JUDO";
    case "TAEKWONDO": return "TAEKWONDO";
    case "SAMBO": return "SAMBO";
    case "COMBAT_SAMBO": return "COMBAT_SAMBO";
    case "BJJ": return "BJJ";
    case "BJJ_NOGI": return "SUBMISSION_GRAPPLING";
    // MMA is the one that must NOT map. It is both a real ruleset and the label
    // every mixed card carries, so an MMA event tells us nothing about whether a
    // given bout on it was MMA — which is the entire bug.
    case "MMA": return null;
    default: return null;
  }
}

/**
 * The ruleset named inside a weight-class label, or null when it names none.
 *
 * Order matters. "Muay Thai" must be tested before "Thai", and MMA last —
 * "mma" appears as a bare token while the others are multi-word, so a loose MMA
 * test would swallow labels it has no claim to.
 */
export function sportFromWeightClass(label: string | null | undefined): Sport | null {
  if (!label) return null;
  const s = label.toLowerCase();
  if (/\bmuay\s*thai\b/.test(s)) return "MUAY_THAI";
  if (/\bkickboxing\b/.test(s)) return "KICKBOXING";
  if (/\bbare[\s-]?knuckle\b/.test(s)) return "BARE_KNUCKLE";
  if (/\bsubmission\s+grappling\b|\bno[\s-]?gi\b/.test(s)) return "BJJ_NOGI";
  if (/\bgrappling\b|\bjiu[\s-]?jitsu\b|\bbjj\b/.test(s)) return "BJJ";
  if (/\bboxing\b/.test(s)) return "BOXING";
  if (/\bmma\b|\bmixed\s+martial\s+arts\b/.test(s)) return "MMA";
  return null;
}

/**
 * The sport of a CARD, from the rulesets its bouts declare.
 *
 * A ONE Friday Fights card is overwhelmingly Muay Thai with the occasional
 * kickboxing bout; a numbered ONE card is mostly MMA with a Muay Thai title
 * fight on it. Event.sport is a single column, so the honest answer is the
 * ruleset most of the card is contested under — and it is a READING of the card,
 * not a rule about the promotion.
 *
 * Ties break toward the configured `fallback` when it is among the tied
 * rulesets, otherwise toward the first in card order — never arbitrarily.
 *
 * Returns `fallback` unchanged when no bout names a ruleset, which is the case
 * for every promotion that runs one and therefore never labels it.
 */
export function dominantSport(
  bouts: { weightClass?: string | null }[],
  fallback: Sport,
): Sport {
  const counts = new Map<Sport, number>();
  const order: Sport[] = [];
  for (const b of bouts) {
    const sport = sportFromWeightClass(b.weightClass);
    if (!sport) continue;
    if (!counts.has(sport)) order.push(sport);
    counts.set(sport, (counts.get(sport) ?? 0) + 1);
  }
  if (counts.size === 0) return fallback;

  let best = order[0];
  let bestCount = counts.get(best)!;
  for (const sport of order) {
    const n = counts.get(sport)!;
    if (n > bestCount) { best = sport; bestCount = n; continue; }
    // Tie: prefer the promotion's configured sport over card order.
    if (n === bestCount && sport === fallback) best = sport;
  }
  return best;
}
