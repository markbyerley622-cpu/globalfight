import "server-only";
import { prisma } from "@/lib/db";

// ════════════════════════════════════════════════════════════════════════════
//  Follow state + follower counts for a whole page of search results.
//
//  Search returns five followable families at once (fighters, events, gyms,
//  promotions, people). Asking "is the viewer following this?" per row would be
//  ~30 queries for one keystroke's worth of results — on a route that fires every
//  180ms as somebody types.
//
//  So this is a fixed, small number of BATCHED queries keyed by the SLUG the
//  FollowButton already uses. Constant query count regardless of how many rows come
//  back, and no slug→id round-trip at the call site: the relation filters do it in
//  the database.
//
//  Signed out is not a special case — the `following` maps are simply empty (the
//  counts still resolve, since they are public), and the button renders unfollowed
//  and sends the reader to /account when tapped.
// ════════════════════════════════════════════════════════════════════════════

export interface SearchFollowState {
  /** slug/username → the viewer follows it. Absent key means not following. */
  following: {
    fighters: Record<string, boolean>;
    events: Record<string, boolean>;
    gyms: Record<string, boolean>;
    promotions: Record<string, boolean>;
    people: Record<string, boolean>;
  };
  /** slug/username → how many people follow it. */
  followers: {
    fighters: Record<string, number>;
    gyms: Record<string, number>;
    promotions: Record<string, number>;
    people: Record<string, number>;
  };
}

const EMPTY: SearchFollowState = {
  following: { fighters: {}, events: {}, gyms: {}, promotions: {}, people: {} },
  followers: { fighters: {}, gyms: {}, promotions: {}, people: {} },
};

export interface SearchKeys {
  fighterSlugs: string[];
  eventSlugs: string[];
  gymSlugs: string[];
  promotionSlugs: string[];
  usernames: string[];
}

const flag = (keys: string[]): Record<string, boolean> => Object.fromEntries(keys.map((k) => [k, true]));

export async function searchFollowState(
  viewerId: string | null,
  keys: SearchKeys,
): Promise<SearchFollowState> {
  const anything =
    keys.fighterSlugs.length || keys.eventSlugs.length || keys.gymSlugs.length ||
    keys.promotionSlugs.length || keys.usernames.length;
  if (!anything) return EMPTY;

  // Gyms are the one family whose follows are stored by ID (the polymorphic Follow
  // table), so their slug↔id pairs are resolved first and then reused for BOTH the
  // follow state and the counts — rather than reading the same rows twice.
  const gymRows = keys.gymSlugs.length
    ? await prisma.gym.findMany({ where: { slug: { in: keys.gymSlugs } }, select: { slug: true, id: true } })
    : [];
  const gymIds = gymRows.map((g) => g.id);

  const [
    myFighters, myEvents, myGymFollows, myPromotions, myPeople,
    fighterCounts, gymCounts, promoCounts, peopleCounts,
  ] = await Promise.all([
    viewerId && keys.fighterSlugs.length
      ? prisma.favoriteFighter.findMany({
          where: { userId: viewerId, fighter: { slug: { in: keys.fighterSlugs } } },
          select: { fighter: { select: { slug: true } } },
        })
      : [],
    viewerId && keys.eventSlugs.length
      ? prisma.favoriteEvent.findMany({
          where: { userId: viewerId, event: { slug: { in: keys.eventSlugs } } },
          select: { event: { select: { slug: true } } },
        })
      : [],
    viewerId && gymIds.length
      ? prisma.follow.findMany({
          where: { userId: viewerId, targetType: "gym", targetId: { in: gymIds } },
          select: { targetId: true },
        })
      : [],
    viewerId && keys.promotionSlugs.length
      ? prisma.favoritePromotion.findMany({
          where: { userId: viewerId, promotion: { in: keys.promotionSlugs } },
          select: { promotion: true },
        })
      : [],
    viewerId && keys.usernames.length
      ? prisma.userFollow.findMany({
          where: { followerId: viewerId, following: { username: { in: keys.usernames } } },
          select: { following: { select: { username: true } } },
        })
      : [],

    keys.fighterSlugs.length
      ? prisma.fighter.findMany({
          where: { slug: { in: keys.fighterSlugs } },
          select: { slug: true, _count: { select: { favoritedBy: true } } },
        })
      : [],
    gymIds.length
      ? prisma.follow.groupBy({
          by: ["targetId"],
          where: { targetType: "gym", targetId: { in: gymIds } },
          _count: { targetId: true },
        })
      : [],
    keys.promotionSlugs.length
      ? prisma.favoritePromotion.groupBy({
          by: ["promotion"],
          where: { promotion: { in: keys.promotionSlugs } },
          _count: { promotion: true },
        })
      : [],
    keys.usernames.length
      ? prisma.user.findMany({
          where: { username: { in: keys.usernames } },
          select: { username: true, _count: { select: { followers: true } } },
        })
      : [],
  ]);

  const followedGymIds = new Set(myGymFollows.map((r) => r.targetId));
  const gymCountById = new Map(gymCounts.map((c) => [c.targetId, c._count.targetId]));

  return {
    following: {
      fighters: flag(myFighters.map((r) => r.fighter.slug)),
      events: flag(myEvents.map((r) => r.event.slug)),
      gyms: flag(gymRows.filter((g) => followedGymIds.has(g.id)).map((g) => g.slug)),
      promotions: flag(myPromotions.map((r) => r.promotion)),
      people: flag(
        myPeople.map((r) => r.following.username).filter((u): u is string => !!u),
      ),
    },
    followers: {
      fighters: Object.fromEntries(fighterCounts.map((f) => [f.slug, f._count.favoritedBy])),
      gyms: Object.fromEntries(gymRows.map((g) => [g.slug, gymCountById.get(g.id) ?? 0])),
      promotions: Object.fromEntries(promoCounts.map((p) => [p.promotion, p._count.promotion])),
      people: Object.fromEntries(
        peopleCounts.flatMap((u) => (u.username ? [[u.username, u._count.followers] as const] : [])),
      ),
    },
  };
}
