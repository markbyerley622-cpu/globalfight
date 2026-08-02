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
