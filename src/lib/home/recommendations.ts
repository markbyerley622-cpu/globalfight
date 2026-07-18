import "server-only";
import { prisma } from "@/lib/db";
import { getUpcomingEvents } from "@/lib/repo";
import { getFollowedPromotionSlugs, getFollowedFighterIds } from "@/lib/follows";
import { getProfileStats, type ProfileStats } from "@/lib/profile-stats";
import { resolvePromotion } from "@/lib/promotions";
import type { FightEvent } from "@/lib/types";

// ── Home recommendation layer ───────────────────────────────────────────────
// A reusable service that ranks what matters to a user right now, organised by
// INTENT not chronology. The homepage just renders what this returns; the same
// ranking can later feed push, email and native. Everything is derived from
// systems already built (follows, picks, the intelligence engine) — no new data.

export interface HomeData {
  personalized: boolean;
  live: FightEvent[]; // happening now — always first
  continueWeek: FightEvent[]; // events you've predicted on
  becauseYouFollow: FightEvent[]; // followed promotion or a fighter on the card
  progress: ProfileStats | null; // your reputation / streak / cards
  trending: FightEvent[]; // everything else upcoming
}

const isFollowed = (e: FightEvent, promos: Set<string>, fighters: Set<string>): boolean =>
  (!!e.promotion && promos.has(resolvePromotion(e.promotion).slug)) ||
  e.fights.some((f) => fighters.has(f.red.id) || fighters.has(f.blue.id));

export async function getHomeSections(userId: string | null): Promise<HomeData> {
  const upcoming = await getUpcomingEvents();
  const live = upcoming.filter((e) => e.status === "LIVE");
  const liveIds = new Set(live.map((e) => e.id));

  if (!userId) {
    return {
      personalized: false,
      live,
      continueWeek: [],
      becauseYouFollow: [],
      progress: null,
      trending: upcoming.filter((e) => !liveIds.has(e.id)).slice(0, 6),
    };
  }

  const [pickRows, promoSlugs, fighterIds, progress] = await Promise.all([
    prisma.fightPick.findMany({ where: { userId }, select: { fight: { select: { eventId: true } } } }),
    getFollowedPromotionSlugs(userId),
    getFollowedFighterIds(userId),
    getProfileStats(userId),
  ]);

  const pickedEventIds = new Set(pickRows.map((p) => p.fight.eventId).filter((x): x is string => !!x));
  const promos = new Set(promoSlugs);

  const continueWeek = upcoming.filter((e) => !liveIds.has(e.id) && pickedEventIds.has(e.id)).slice(0, 6);
  const continueIds = new Set(continueWeek.map((e) => e.id));

  const becauseYouFollow = upcoming
    .filter((e) => !liveIds.has(e.id) && !continueIds.has(e.id) && isFollowed(e, promos, fighterIds))
    .slice(0, 6);

  const used = new Set([...liveIds, ...continueIds, ...becauseYouFollow.map((e) => e.id)]);
  const trending = upcoming.filter((e) => !used.has(e.id)).slice(0, 6);

  return { personalized: true, live, continueWeek, becauseYouFollow, progress, trending };
}
