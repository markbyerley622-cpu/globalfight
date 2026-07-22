import "server-only";
import { prisma } from "@/lib/db";
import { resolvePromotion } from "@/lib/promotions";
import { track } from "@/lib/analytics";

// ── Following ───────────────────────────────────────────────────────────────
// Wires the previously-dead FavoriteFighter table + the new FavoritePromotion
// table into real follow toggles. Promotions are keyed by REGISTRY slug
// (resolvePromotion().slug) so a follow is stable regardless of the free-text
// promotion name on an event. These feed the personalized home rail.

/**
 * Follow / unfollow a fighter.
 *
 * `on` is the caller's EXPLICIT intent. Pass it and the call is idempotent —
 * two taps that both mean "follow" leave you following. Omit it and this
 * toggles, which is what the routes did unconditionally and is a real defect
 * under a double tap: two toggles net to a no-op while the optimistic UI shows
 * one flip, so the button and the database end up disagreeing.
 */
export async function toggleFollowFighter(
  userId: string,
  fighterSlug: string,
  on?: boolean,
): Promise<{ following: boolean }> {
  const f = await prisma.fighter.findUnique({ where: { slug: fighterSlug }, select: { id: true } });
  if (!f) throw new Error("Fighter not found");
  const key = { userId_fighterId: { userId, fighterId: f.id } };
  const existing = await prisma.favoriteFighter.findUnique({ where: key, select: { userId: true } });
  const shouldFollow = on ?? !existing;
  if (!shouldFollow) {
    // deleteMany, not delete: a second tap that lands after the first already
    // removed the row must be a no-op, not a P2025 surfaced as a 400.
    await prisma.favoriteFighter.deleteMany({ where: { userId, fighterId: f.id } });
    return { following: false };
  }
  if (existing) return { following: true }; // already there — nothing to write
  // createMany(skipDuplicates) rather than create(): this is a check-then-act,
  // and a double tap or a second tab can interleave between the read above and
  // the write. create() would throw P2002 and the route would answer 400 —
  // "could not follow" for an action that in fact succeeded a millisecond ago.
  const { count } = await prisma.favoriteFighter.createMany({
    data: [{ userId, fighterId: f.id }],
    skipDuplicates: true,
  });
  // Only count a follow that this call actually created, so a duplicate request
  // cannot inflate the analytics.
  if (count > 0) track("follow_fighter", userId, { fighter: fighterSlug });
  return { following: true };
}

export async function isFollowingFighter(userId: string, fighterId: string): Promise<boolean> {
  const row = await prisma.favoriteFighter.findUnique({
    where: { userId_fighterId: { userId, fighterId } },
    select: { userId: true },
  });
  return !!row;
}

/** `promotion` is any free-text promotion string; it's normalised to a registry slug. */
export async function toggleFollowPromotion(
  userId: string,
  promotion: string,
  on?: boolean,
): Promise<{ following: boolean }> {
  const slug = resolvePromotion(promotion).slug;
  const key = { userId_promotion: { userId, promotion: slug } };
  const existing = await prisma.favoritePromotion.findUnique({ where: key, select: { userId: true } });
  const shouldFollow = on ?? !existing;
  if (!shouldFollow) {
    // deleteMany + skipDuplicates: the same check-then-act race the event
    // helper already documents. delete() on a row a concurrent tap removed
    // throws P2025 and surfaces as "could not follow" for a completed action.
    await prisma.favoritePromotion.deleteMany({ where: { userId, promotion: slug } });
    return { following: false };
  }
  if (existing) return { following: true };
  const { count } = await prisma.favoritePromotion.createMany({
    data: [{ userId, promotion: slug }],
    skipDuplicates: true,
  });
  if (count > 0) track("follow_promotion", userId, { promotion: slug });
  return { following: true };
}

export async function isFollowingPromotion(userId: string, promotion: string): Promise<boolean> {
  const slug = resolvePromotion(promotion).slug;
  const row = await prisma.favoritePromotion.findUnique({
    where: { userId_promotion: { userId, promotion: slug } },
    select: { userId: true },
  });
  return !!row;
}

// ── Events ───────────────────────────────────────────────────────────────────
// Following an EVENT is the strongest intent signal in Phase 1: it means "remind
// me". It is what the Following feed and the reminder scheduler key off, and it
// is deliberately separate from following the promotion that runs it.

export async function toggleFollowEvent(userId: string, eventSlug: string, on?: boolean): Promise<{ following: boolean }> {
  const e = await prisma.event.findUnique({ where: { slug: eventSlug }, select: { id: true } });
  if (!e) throw new Error("Event not found");
  const key = { userId_eventId: { userId, eventId: e.id } };
  const existing = await prisma.favoriteEvent.findUnique({ where: key, select: { userId: true } });

  // Conflict-TOLERANT toggle. Read-then-write is a check-then-act race that a
  // double-tap loses, and this is one of the most tapped controls in the app:
  // six concurrent follows produced four 400s against a live database
  // (`delete` on an already-deleted row, `create` on an existing one).
  //
  // deleteMany never throws when the row is gone, and the create's unique
  // violation is swallowed because losing that race means somebody else
  // already achieved the caller's intent. The end state is what matters.
  const shouldFollow = on ?? !existing;
  if (!shouldFollow) {
    await prisma.favoriteEvent.deleteMany({ where: { userId, eventId: e.id } });
    return { following: false };
  }
  try {
    await prisma.favoriteEvent.create({ data: { userId, eventId: e.id } });
  } catch (err) {
    if ((err as { code?: string }).code !== "P2002") throw err;
    return { following: true }; // already following — same outcome
  }
  track("follow_event", userId, { event: eventSlug });
  return { following: true };
}

export async function isFollowingEvent(userId: string, eventId: string): Promise<boolean> {
  const row = await prisma.favoriteEvent.findUnique({
    where: { userId_eventId: { userId, eventId } },
    select: { userId: true },
  });
  return !!row;
}

/** Event ids a user follows, for batch-marking lists without an N+1. */
export async function getFollowedEventIds(userId: string): Promise<Set<string>> {
  const rows = await prisma.favoriteEvent.findMany({ where: { userId }, select: { eventId: true } });
  return new Set(rows.map((r) => r.eventId));
}

/** Registry slugs of the promotions a user follows (for personalized surfaces). */
export async function getFollowedPromotionSlugs(userId: string): Promise<string[]> {
  const rows = await prisma.favoritePromotion.findMany({ where: { userId }, select: { promotion: true } });
  return rows.map((r) => r.promotion);
}

/** Fighter ids a user follows (cheap set for badging cards). */
export async function getFollowedFighterIds(userId: string): Promise<Set<string>> {
  const rows = await prisma.favoriteFighter.findMany({ where: { userId }, select: { fighterId: true } });
  return new Set(rows.map((r) => r.fighterId));
}
