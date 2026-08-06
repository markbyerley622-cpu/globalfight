import { canonicalizeTitle } from "@/lib/text/entities";

// ════════════════════════════════════════════════════════════════════════════
//  ARTICLE → EVENT MATCHING. Pure, deterministic, and biased toward SKIPPING.
//
//  ── The rule ─────────────────────────────────────────────────────────────
//  A skipped article costs one event staying empty for another day.
//  A WRONG match writes nine bouts onto somebody else's card, and every one of
//  them then looks like real data — with fighters, methods and rounds attached.
//  The second is unrecoverable without an audit; the first is a retry.
//
//  So there is no similarity score and no threshold to tune. Either the event
//  name recovered from the article's title canonicalises to exactly the same
//  string as an event we hold, or the article is skipped and queued for review.
//
//  ── Why the title, and not the date ──────────────────────────────────────
//  The listing publishes "Jul 31" with no year, so a date alone cannot identify
//  an event and would silently collapse annual editions of the same card. The
//  event NAME is in both the article title and the URL slug, and ONE names its
//  events unambiguously ("ONE Fight Night 45", "ONE Friday Fights 164"). Date is
//  used only as a CORROBORATION band where the article supplies a real one —
//  never as the identifier.
// ════════════════════════════════════════════════════════════════════════════

/**
 * The editorial suffix ONE appends to a results article.
 *
 * "…For Every Match" and "…For Every Fight" both occur — the dry run found the
 * second on ONE SAMURAI 1, which was the single article out of twenty that
 * failed to match once the rest were working. The trailing noun is optional
 * entirely, so a third variant costs nothing.
 */
const SUFFIX = /\s*[–—-]\s*(?:live\s+)?results\s+and\s+highlights(?:\s+for\s+every\s+\w+)?\s*$/i;

/**
 * A night that ran TWO cards, written as one string.
 *
 * Both sides publish these, and differently: the article says "The Inner Circle
 * 24 And ONE Friday Fights 164", the registry stores "ONE Friday Fights 164 &
 * The Inner Circle 24". Same night, same two events, opposite order and a
 * different conjunction — so both forms have to split, and the result is a SET
 * of names rather than one.
 */
// `&` splits unconditionally; " and " only before a known card prefix.
//
// The asymmetry is deliberate. An ampersand between two card names is
// unambiguous punctuation, and splitting on it cannot manufacture a false match:
// a hit still requires one of the halves to canonicalise to EXACTLY a registry
// name. The word "and", by contrast, appears inside real event names, so it
// stays gated on a following card prefix.
const CONJUNCTION = /\s+&\s+|\s+and\s+(?=one\b|the\s+inner\s+circle\b)/i;

/**
 * Every card name a string refers to.
 *
 * Applied to the ARTICLE TITLE and to the REGISTRY NAME, deliberately. The first
 * dry run matched 0 of 20 articles because only the article side was being
 * normalised: the parser correctly recovered "ONE Fight Night 45" while the
 * registry held "ONE Fight Night 45: Lessei vs. Rabah", and
 * "ONE Friday Fights 164" against "ONE Friday Fights 164 & The Inner Circle 24".
 *
 * Both sides through one function is the fix, and it is also the only version
 * that stays correct when either side changes its house style — an asymmetric
 * normaliser is a bug waiting for someone to rename an event.
 */
export function cardNames(text: string): string[] {
  const base = (text ?? "").replace(/\s+/g, " ").trim().replace(SUFFIX, "").trim();
  if (!base) return [];

  return base
    .split(CONJUNCTION)
    .map((part) =>
      part
        // "ONE Fight Night 45: Lessei vs. Rabah" → the card name. The headline
        // bout is not part of it, and the two sides disagree about whether to
        // include it.
        .split(/\s*[:|]\s*/)[0]
        // The same split without punctuation: "… 45 Lessei Vs Rabah".
        .replace(/\s+\S+\s+vs\.?\s+\S+.*$/i, "")
        .replace(/\s+/g, " ")
        .trim(),
    )
    .filter((n) => n.length >= 4);
}

/** Back-compat alias — the article side of the same function. */
export const eventNamesFromTitle = cardNames;

export interface EventCandidate {
  id: string;
  name: string;
  date: Date;
}

export type MatchOutcome =
  | { ok: true; eventId: string; matchedName: string; via: "canonical_title" }
  | { ok: false; reason: "no_name" | "no_match" | "ambiguous"; names: string[] };

export interface MatchOpts {
  /** The article's own publication date, when the page supplied one. */
  articleDate?: Date | null;
  /**
   * How far an event may sit from the article date and still corroborate.
   *
   * Generous: a results article publishes within hours, but a card that ran on a
   * Friday in one timezone is a Saturday in another, and historical backfills
   * are written days later. Wide enough not to reject truth, narrow enough to
   * catch an annual re-run of the same card name.
   */
  windowDays?: number;
}

/**
 * Resolve one article to one event, or refuse.
 *
 * `candidates` is the caller's shortlist — ONE events from the registry. This
 * function never queries; it compares canonical strings, so every verdict is
 * reproducible and testable without a database.
 */
export function matchArticleToEvent(
  title: string,
  candidates: EventCandidate[],
  opts: MatchOpts = {},
): MatchOutcome {
  const names = cardNames(title);
  if (names.length === 0) return { ok: false, reason: "no_name", names: [] };

  const windowMs = (opts.windowDays ?? 10) * 86_400_000;

  const hits: EventCandidate[] = [];
  const matchedFor = new Map<string, string>();

  for (const name of names) {
    const wanted = canonicalizeTitle(name);
    if (!wanted) continue;
    for (const c of candidates) {
      // The candidate's OWN name goes through the same normalisation — see
      // cardNames. A registry entry naming two cards matches an article about
      // either of them.
      if (!cardNames(c.name).some((cn) => canonicalizeTitle(cn) === wanted)) continue;
      // Date corroborates when we have one; it never IDENTIFIES.
      if (opts.articleDate && Math.abs(c.date.getTime() - opts.articleDate.getTime()) > windowMs) continue;
      if (!hits.some((h) => h.id === c.id)) {
        hits.push(c);
        matchedFor.set(c.id, name);
      }
    }
  }

  if (hits.length === 0) return { ok: false, reason: "no_match", names };
  // Two events with the same canonical name inside the date window is exactly
  // the case a similarity score would resolve by guessing. Refuse it.
  if (hits.length > 1) return { ok: false, reason: "ambiguous", names };

  return { ok: true, eventId: hits[0].id, matchedName: matchedFor.get(hits[0].id) ?? names[0], via: "canonical_title" };
}
