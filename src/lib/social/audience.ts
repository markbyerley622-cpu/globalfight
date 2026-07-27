import "server-only";
import { prisma } from "@/lib/db";
import { resolvePromotion } from "@/lib/promotions";
import type { FollowTarget } from "@/lib/follow-targets";

// ════════════════════════════════════════════════════════════════════════════
//  WHO hears about a thing — resolved in one place, for every trigger.
//
//  There are now a dozen triggers (event announced, card published, main event
//  changed, bout scratched, result confirmed …) and they mostly differ only in
//  their COPY. The part that is easy to get wrong is the audience: which follow
//  targets a fact reaches, and how a promotion is identified.
//
//  So the audience is computed here and nowhere else. A trigger that wants "the
//  people who care about this event" asks for it; it does not assemble the list
//  itself, which is how the fourth one quietly forgets the promotion.
// ════════════════════════════════════════════════════════════════════════════

/**
 * The promotion follow target for an event's promotion text — REGISTRY ONLY.
 *
 * FavoritePromotion is keyed by registry slug ("ufc"). An Event carries free text
 * ("UFC", "UFC Fight Night 250", "Various"). Passing that text as an identifier
 * matches no follower and fails SILENTLY — the fan-out simply reaches one audience
 * fewer, with nothing in the logs to say so. That bug shipped once already.
 *
 * An unknown promotion resolves to the neutral "combat" fallback, which is not an
 * organisation anybody can follow. That is not an error: a Wikidata card billed as
 * "Various" has no promotion, and the correct behaviour is to skip that audience
 * and still tell the fighters' and the event's followers.
 */
export function promotionTarget(promotionText?: string | null): FollowTarget | null {
  if (!promotionText) return null;
  const promo = resolvePromotion(promotionText);
  if (!promo || promo.slug === "combat") return null;
  return { type: "promotion", id: promo.slug };
}

/** The shape every event trigger needs. Selected once, never re-fetched per audience. */
export interface EventRef {
  id: string;
  slug: string;
  name: string;
  promotion: string | null;
}

export const EVENT_REF_SELECT = { id: true, slug: true, name: true, promotion: true } as const;

export async function eventRef(eventId: string): Promise<EventRef | null> {
  return prisma.event.findUnique({ where: { id: eventId }, select: EVENT_REF_SELECT });
}

/**
 * Everyone with a reason to care about an EVENT: its own followers and the
 * promotion's.
 *
 * Fighter followers are deliberately NOT here. "This card was announced" is news
 * about a card; a fighter's followers get told when that FIGHTER is booked on it,
 * which is a different fact with different copy and its own dedupe key. Folding
 * them in here would mean a fan of one fighter is notified about every card-level
 * edit on every event that fighter appears on.
 */
export function eventTargets(event: EventRef): FollowTarget[] {
  const targets: FollowTarget[] = [{ type: "event", id: event.id }];
  const promo = promotionTarget(event.promotion);
  if (promo) targets.push(promo);
  return targets;
}

/**
 * Everyone with a reason to care about a BOUT: both corners' followers, the
 * event's, and the promotion's.
 *
 * Four audiences, ONE dedupeKey at the call site — a reader following the fighter
 * AND the event AND the promotion is one person who wants one notification. The
 * (userId, dedupeKey) unique enforces that; this function just makes sure nobody
 * is left out of the attempt.
 */
export function fightTargets(fight: {
  redId: string;
  blueId: string;
  event: EventRef | null;
}): FollowTarget[] {
  const targets: FollowTarget[] = [
    { type: "fighter", id: fight.redId },
    { type: "fighter", id: fight.blueId },
  ];
  if (fight.event) targets.push(...eventTargets(fight.event));
  return targets;
}

/** Just the two corners — for news that is about the fighters, not the card. */
export function cornerTargets(fight: { redId: string; blueId: string }): FollowTarget[] {
  return [
    { type: "fighter", id: fight.redId },
    { type: "fighter", id: fight.blueId },
  ];
}
