// ════════════════════════════════════════════════════════════════════════
//  TournamentCard → canonical NormalizedEvent. PURE — no network, no prisma.
//
//  Everything downstream (dedupe, corner-pair identity, settlement, provenance)
//  is the shared pipeline's job; this only translates shapes.
// ════════════════════════════════════════════════════════════════════════

import type { NormalizedEvent, NormalizedFightStub, SourceMeta } from "@/services/providers/types";
import type { Sport } from "@/lib/types";
import { slugify } from "@/lib/utils";
import type { TournamentBout, TournamentCard } from "./types";

/**
 * A source key of its OWN, distinct from the wikicard provider's "wikipedia".
 *
 * Same website, different claim: wikicard reads a promotion's results table,
 * this reads a tournament bracket. Keeping them apart means FightImport records
 * which one wrote a bout, and — the reason it matters operationally —
 * `npm run cleanup:wikicards` can undo one without touching the other.
 */
export const TOURNAMENT_SOURCE = "wikipedia-tournament";
/** Cited and editorially maintained, but community-edited: below an official feed. */
export const TOURNAMENT_CONFIDENCE = 0.75;

const meta = (externalId: string, lastUpdated: string): SourceMeta => ({
  source: TOURNAMENT_SOURCE,
  confidence: TOURNAMENT_CONFIDENCE,
  lastUpdated,
  externalId,
});

/** One reconstructed bout → a fight stub. */
export function toFightStub(
  bout: TournamentBout,
  division: string | null,
  scheduledRounds: number,
): NormalizedFightStub {
  const redExternalId = slugify(bout.redName);
  const blueExternalId = slugify(bout.blueName);

  // No winner marked in the source ⇒ SCHEDULED. The pairing is still worth
  // storing; the outcome is not ours to supply.
  const decided = bout.winner !== null;

  return {
    redName: bout.redName,
    blueName: bout.blueName,
    redExternalId,
    blueExternalId,
    // A medal-table bout knows its own division; a bracket bout takes the page's.
    weightClass: bout.division ?? division ?? undefined,
    scheduledRounds,
    // The gold-medal bout of a world championship or Olympic Games is a title
    // bout. A bronze-medal match is not.
    titleFight: bout.rank === 100,
    mainEvent: bout.rank === 100,
    result: decided ? "WIN" : "SCHEDULED",
    // METHOD IS DELIBERATELY ABSENT.
    //
    // A bracket gives a score ("10", "11F", "VSU", "1s1"), not a method. Mapping
    // a wrestling technical superiority or a judo ippon onto a boxing enum
    // (KO/TKO/UD/SUB) would be inventing a fact with a plausible shape — the one
    // failure mode this pipeline is built to refuse. The winner is recorded; how
    // they won is left null until a source states it.
    winnerExternalId: decided ? (bout.winner === "red" ? redExternalId : blueExternalId) : undefined,
  };
}

export function toNormalizedEvent(
  card: TournamentCard,
  sport: Sport,
  promotion: string,
  scheduledRounds: number,
  now: Date = new Date(),
): NormalizedEvent | null {
  if (!card.date || !card.bouts.length) return null;

  // Bouts arrive Final-first (bracket.ts sorts by rank), which is what
  // persist.ts turns into orderOnCard — main event 0, then down the card.
  const fights = card.bouts.map((b) => toFightStub(b, card.division, scheduledRounds));

  return {
    externalId: `wp:${card.sourceTitle}`,
    name: card.name,
    sport,
    promotion,
    venue: card.venue ?? undefined,
    city: card.city ?? undefined,
    country: card.country ?? undefined,
    date: card.date,
    status: new Date(card.date) < now ? "COMPLETED" : "SCHEDULED",
    fights,
    _meta: meta(`wp:${card.sourceTitle}`, now.toISOString()),
  };
}
