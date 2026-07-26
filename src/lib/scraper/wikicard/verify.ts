// ════════════════════════════════════════════════════════════════════════════
//  Match verification — accept a page for its CONTENT, not its title.
//
//  PURE. No prisma, no network.
//
//  The old acceptance test was `titleMatches()`: a normalized prefix comparison
//  between the event name we searched for and the page title we got back. That is
//  only safe when the query IS the title. The moment the ladder searches by bout,
//  by fighter names, or by an alias, a title test either rejects a correct page
//  ("Errol Spence Jr. vs. Terence Crawford" doesn't prefix-match "Errol Spence Jr
//  Tim Tszyu") or — far worse — accepts a wrong one and writes another fight's
//  result onto our bout.
//
//  So verification asks the only question that actually matters:
//
//      does this page's card contain a bout between the two fighters we came for?
//
//  Fighter names are compared through ENTITY RESOLUTION (lib/entities), so a page
//  writing "Anthony Oluwafemi Joshua", "A. Joshua" or a registry alias still
//  verifies, while a page about two different people cannot. The candidate set is
//  closed — the corners of the bouts we are looking for — which is exactly the
//  context in which the weak forms are legal.
//
//  This is what keeps the widened search truthful: a loose QUERY is safe because
//  ACCEPTANCE is strict.
// ════════════════════════════════════════════════════════════════════════════

import { resolveName, type ResolvedEntity } from "@/lib/entities/resolve";
import type { WikiBout } from "./extract";

/** A bout we are trying to find a result for. */
export interface ExpectedBout {
  red: ResolvedEntity;
  blue: ResolvedEntity;
}

export interface VerifiedMatch {
  /** Bouts on the page that resolve to a bout we were looking for. */
  matched: number;
  /** Total bouts parsed from the page (the card we would persist). */
  parsed: number;
  /** Which of the expected bouts were found, for the report. */
  matchedPairs: { red: string; blue: string }[];
}

/**
 * Does this parsed card contain any of the bouts we came for?
 *
 * Requires BOTH corners of a parsed bout to resolve, and to resolve to the two
 * distinct fighters of the SAME expected bout. One name matching is not a bout —
 * fight cards are full of fighters who appear on many cards.
 */
export function verifyCard(bouts: WikiBout[], expected: ExpectedBout[]): VerifiedMatch {
  const matchedPairs: { red: string; blue: string }[] = [];
  if (!bouts.length || !expected.length) return { matched: 0, parsed: bouts.length, matchedPairs };

  // Closed candidate set: only the corners of the bouts we are looking for.
  const candidates: ResolvedEntity[] = [];
  for (const e of expected) candidates.push(e.red, e.blue);

  const pairKey = (a: string, b: string) => [a, b].sort().join("|");
  const wanted = new Map<string, ExpectedBout>();
  for (const e of expected) {
    if (e.red.id && e.blue.id) wanted.set(pairKey(e.red.id, e.blue.id), e);
  }

  const seen = new Set<string>();
  for (const bout of bouts) {
    const red = resolveName(bout.redName, candidates);
    const blue = resolveName(bout.blueName, candidates);
    if (!red.ok || !blue.ok) continue;
    const rId = red.entity.id;
    const bId = blue.entity.id;
    // Two corners of one bout are never the same fighter; a page that resolves both
    // sides to the same person is a parse artefact, not a match.
    if (!rId || !bId || rId === bId) continue;

    const key = pairKey(rId, bId);
    const hit = wanted.get(key);
    if (!hit || seen.has(key)) continue;
    seen.add(key);
    matchedPairs.push({ red: hit.red.name, blue: hit.blue.name });
  }

  return { matched: matchedPairs.length, parsed: bouts.length, matchedPairs };
}

/**
 * Is this match strong enough to persist?
 *
 * One verified bout is enough — a standalone fight article legitimately carries a
 * single bout, and that bout is precisely what we were missing. Zero is a rejection,
 * and rejection is the safe default: leaving a bout unresolved is honest, writing
 * the wrong fighter's result is not.
 */
export function isAcceptable(match: VerifiedMatch): boolean {
  return match.matched >= 1;
}
