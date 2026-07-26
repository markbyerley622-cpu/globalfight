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
  /** Total bouts parsed from the page. */
  parsed: number;
  /** Which of the expected bouts were found, for the report. */
  matchedPairs: { red: string; blue: string }[];
  /**
   * ONLY the parsed bouts that resolve to a bout we came for.
   *
   * This is what may be persisted, and the distinction is not cosmetic. Wikipedia
   * keeps season pages — "2026 in Bare Knuckle Fighting Championship" carries EVERY
   * card of the year. Such a page verifies correctly (our bout really is on it) and
   * then, if the whole parsed table were attached, dumps ~500 bouts from other events
   * onto this one event. A historical run reported 3,803 bouts across 20 events; real
   * cards are 10–13. Attaching a superset is not a performance problem, it is
   * fabricated card data.
   */
  bouts: WikiBout[];
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
  const matchedBouts: WikiBout[] = [];
  if (!bouts.length || !expected.length) {
    return { matched: 0, parsed: bouts.length, matchedPairs, bouts: [] };
  }

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
    matchedBouts.push(bout);
  }

  return { matched: matchedPairs.length, parsed: bouts.length, matchedPairs, bouts: matchedBouts };
}

/**
 * Acceptance for a CARD-BACKFILL target — an event with no bouts at all, so there is
 * nothing to verify against.
 *
 * Content verification is impossible here, so the title must carry the proof instead.
 * That is safe precisely because the query for this gap IS the event title: a strict
 * normalized prefix match between what we asked for and what came back. Anything
 * looser would attach a stranger's card to our event.
 *
 * (This is the original `titleMatches` rule, kept for the one case it was correct
 * for. Introducing content verification without keeping it silently made every
 * card-backfill target unverifiable, since `expectedBouts` is empty by definition.)
 */
export function verifyTitle(eventName: string, pageTitle: string): boolean {
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();
  const want = norm(eventName);
  const got = norm(pageTitle);
  if (!want || !got) return false;
  if (want === got) return true;
  // "ONE Fight Night 39" ⊂ "ONE Fight Night 39: Superlek vs Takeru" and vice-versa.
  return want.startsWith(got) || got.startsWith(want);
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
