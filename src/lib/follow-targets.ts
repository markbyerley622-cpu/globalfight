import "server-only";
import { prisma } from "@/lib/db";

import {
  toggleFollowFighter, toggleFollowPromotion, toggleFollowEvent,
  isFollowingFighter, isFollowingPromotion, isFollowingEvent,
} from "@/lib/follows";
import { setFollow } from "@/lib/geo/people";

// ════════════════════════════════════════════════════════════════════════════
//  ONE follow API over every entity.
//
//  Following already existed as three separate tables — FavoriteFighter,
//  FavoritePromotion, FavoriteEvent — each with its own toggle, lookup and count.
//  Adding gyms and people that way meant two more tables and two more of
//  everything, and every future entity another pair. That is the "second social
//  subsystem" this sprint is meant to avoid.
//
//  So: new targets live in the polymorphic Follow table, and this module presents a
//  single `toggleFollow(user, target)` over BOTH. The legacy tables are routed to,
//  not replaced — they carry real user data behind real foreign keys, and rewriting
//  working follows is risk with no user-visible payoff. Callers stop caring which
//  storage a target uses, which is the property that makes the next entity free.
//
//  Adding a target type is one line in FOLLOW_TARGETS. No schema change.
// ════════════════════════════════════════════════════════════════════════════

export type FollowTargetType = "fighter" | "promotion" | "event" | "gym" | "person";

export interface FollowTarget {
  type: FollowTargetType;
  /** Stable id: a cuid for a row-backed entity, a registry slug for a promotion. */
  id: string;
}

/** Which notification preference governs this target's notifications. */
export type NotifyCategory = "fights" | "predictions" | "social" | "gym";

interface TargetSpec {
  /** Legacy targets keep their own table; new ones use the polymorphic Follow row. */
  legacy: boolean;
  category: NotifyCategory;
  /** Never let a user follow themselves. */
  selfFollowable: boolean;
}

const FOLLOW_TARGETS: Record<FollowTargetType, TargetSpec> = {
  fighter: { legacy: true, category: "fights", selfFollowable: true },
  promotion: { legacy: true, category: "fights", selfFollowable: true },
  event: { legacy: true, category: "fights", selfFollowable: true },
  gym: { legacy: false, category: "gym", selfFollowable: true },
  // PERSON follows already exist, in UserFollow, with their own API and profile
  // counts. Routing them through the polymorphic table would have created exactly
  // the second social subsystem this sprint exists to avoid — two tables that both
  // believe they know who follows whom. So person is legacy too.
  person: { legacy: true, category: "social", selfFollowable: false },
};

export const isFollowTargetType = (t: string): t is FollowTargetType => t in FOLLOW_TARGETS;
export const notifyCategoryFor = (type: FollowTargetType): NotifyCategory =>
  FOLLOW_TARGETS[type].category;

export class SelfFollowError extends Error {
  constructor() {
    super("You cannot follow yourself.");
  }
}

/**
 * Follow / unfollow anything.
 *
 * `on` is the caller's EXPLICIT intent, and passing it makes the call idempotent —
 * two taps that both mean "follow" leave you following. Omitting it toggles, which
 * under a double tap nets to a no-op while the optimistic UI shows one flip, so the
 * button and the database end up disagreeing. Same rule the fighter/promotion
 * toggles already follow.
 */
export async function toggleFollow(
  userId: string,
  target: FollowTarget,
  on?: boolean,
): Promise<{ following: boolean }> {
  const spec = FOLLOW_TARGETS[target.type];
  if (!spec) throw new Error(`Unknown follow target: ${target.type}`);
  if (!spec.selfFollowable && target.id === userId) throw new SelfFollowError();

  if (spec.legacy) {
    // A pre-existing inconsistency this unified API surfaces: toggleFollowFighter and
    // toggleFollowEvent take a SLUG, while isFollowingFighter/Event take an ID. That
    // is invisible while each entity has its own call site and a trap the moment one
    // API covers both — "Fighter not found" for an id that exists.
    //
    // FollowTarget.id is always the ROW ID, one meaning everywhere. The slug is
    // resolved here rather than pushed onto every caller.
    if (target.type === "promotion") return toggleFollowPromotion(userId, target.id, on);
    if (target.type === "person") {
      const following = on ?? !(await isFollowingPerson(userId, target.id));
      await setFollow(userId, target.id, following);
      return { following };
    }
    if (target.type === "fighter" || target.type === "event") {
      const slug = await legacySlug(target.type, target.id);
      // A follow of something that no longer exists is not an error worth throwing
      // at a reader mid-tap; it is simply not following.
      if (!slug) return { following: false };
      return target.type === "fighter"
        ? toggleFollowFighter(userId, slug, on)
        : toggleFollowEvent(userId, slug, on);
    }
  }

  const where = {
    userId_targetType_targetId: { userId, targetType: target.type, targetId: target.id },
  };
  const existing = await prisma.follow.findUnique({ where, select: { id: true } });
  const following = on ?? !existing;

  if (following && !existing) {
    // The (userId, targetType, targetId) unique is the real guard: a replayed
    // request or a double tap cannot create a second row — and therefore cannot
    // fan out a second notification.
    await prisma.follow.create({
      data: { userId, targetType: target.type, targetId: target.id },
    });
  } else if (!following && existing) {
    await prisma.follow.delete({ where });
  }

  // Analytics: the legacy toggles emit their own typed events (follow_fighter,
  // follow_promotion, follow_event). The new target types have no event in the
  // analytics union yet, and widening that contract is a deliberate decision rather
  // than a side effect of this file — so gym/person follows are intentionally not
  // tracked yet rather than silently mistyped as something else.
  return { following };
}

/** Person follows live in UserFollow — one row per (follower, following). */
async function isFollowingPerson(userId: string, targetId: string): Promise<boolean> {
  const row = await prisma.userFollow.findUnique({
    where: { followerId_followingId: { followerId: userId, followingId: targetId } },
    select: { id: true },
  });
  return !!row;
}

/** The slug the legacy toggles want, from the row id every caller passes. */
async function legacySlug(type: "fighter" | "event", id: string): Promise<string | null> {
  const row =
    type === "fighter"
      ? await prisma.fighter.findUnique({ where: { id }, select: { slug: true } })
      : await prisma.event.findUnique({ where: { id }, select: { slug: true } });
  return row?.slug ?? null;
}

/** Is the viewer following this target? */
export async function isFollowing(userId: string, target: FollowTarget): Promise<boolean> {
  const spec = FOLLOW_TARGETS[target.type];
  if (!spec) return false;
  if (spec.legacy) {
    if (target.type === "fighter") return isFollowingFighter(userId, target.id);
    if (target.type === "promotion") return isFollowingPromotion(userId, target.id);
    if (target.type === "person") return isFollowingPerson(userId, target.id);
    return isFollowingEvent(userId, target.id);
  }
  const row = await prisma.follow.findUnique({
    where: { userId_targetType_targetId: { userId, targetType: target.type, targetId: target.id } },
    select: { id: true },
  });
  return !!row;
}

/** How many people follow this target. Indexed on (targetType, targetId). */
export async function followerCount(target: FollowTarget): Promise<number> {
  const spec = FOLLOW_TARGETS[target.type];
  if (spec?.legacy) {
    if (target.type === "person") return prisma.userFollow.count({ where: { followingId: target.id } });
    if (target.type === "fighter") return prisma.favoriteFighter.count({ where: { fighterId: target.id } });
    if (target.type === "promotion") return prisma.favoritePromotion.count({ where: { promotion: target.id } });
    return prisma.favoriteEvent.count({ where: { eventId: target.id } });
  }
  return prisma.follow.count({ where: { targetType: target.type, targetId: target.id } });
}

/**
 * Everyone following this target, minus anyone excluded (the actor — nobody should
 * be notified about their own action) and minus anyone whose preferences say no.
 *
 * ONE query for the followers and ONE for their preferences, not one per follower:
 * a gym with 2,000 followers must not become 2,000 round-trips. The preference
 * check happens HERE rather than inside notify() so a muted category costs nothing
 * downstream — no row written, no push attempted.
 */
export async function followerIdsToNotify(
  target: FollowTarget,
  opts: { exclude?: (string | null | undefined)[] } = {},
): Promise<string[]> {
  const spec = FOLLOW_TARGETS[target.type];
  if (!spec) return [];

  let ids: string[];
  if (spec.legacy) {
    if (target.type === "person") {
      const rows = await prisma.userFollow.findMany({
        where: { followingId: target.id }, select: { followerId: true },
      });
      ids = rows.map((r) => r.followerId);
      const ex = new Set(opts.exclude?.filter(Boolean) as string[]);
      return filterByPreference(ids.filter((id) => !ex.has(id)), spec.category);
    }
    const rows =
      target.type === "fighter"
        ? await prisma.favoriteFighter.findMany({ where: { fighterId: target.id }, select: { userId: true } })
        : target.type === "promotion"
          ? await prisma.favoritePromotion.findMany({ where: { promotion: target.id }, select: { userId: true } })
          : await prisma.favoriteEvent.findMany({ where: { eventId: target.id }, select: { userId: true } });
    ids = rows.map((r) => r.userId);
  } else {
    const rows = await prisma.follow.findMany({
      where: { targetType: target.type, targetId: target.id },
      select: { userId: true },
    });
    ids = rows.map((r) => r.userId);
  }

  const excluded = new Set(opts.exclude?.filter(Boolean) as string[]);
  ids = ids.filter((id) => !excluded.has(id));
  if (!ids.length) return [];

  return filterByPreference(ids, spec.category);
}

const PREF_COLUMN: Record<NotifyCategory, "notifyFights" | "notifyPredictions" | "notifySocial" | "notifyGym"> = {
  fights: "notifyFights",
  predictions: "notifyPredictions",
  social: "notifySocial",
  gym: "notifyGym",
};

/**
 * Keep only the users who want this category. One query for the whole set.
 *
 * There is no bypass: a subsystem that wants to notify followers goes through
 * followerIdsToNotify, and a user who turned the category off is simply not in the
 * list it returns.
 */
export async function filterByPreference(userIds: string[], category: NotifyCategory): Promise<string[]> {
  if (!userIds.length) return [];
  const column = PREF_COLUMN[category];
  const rows = await prisma.user.findMany({
    where: { id: { in: userIds }, [column]: true },
    select: { id: true },
  });
  return rows.map((r) => r.id);
}
