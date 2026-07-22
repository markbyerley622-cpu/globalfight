import "server-only";
import { prisma } from "@/lib/db";
import { getUpcomingEvents } from "@/lib/repo";
import { getFollowedPromotionSlugs, getFollowedFighterIds } from "@/lib/follows";
import { getProfileStats, type ProfileStats } from "@/lib/profile-stats";
import { resolvePromotion } from "@/lib/promotions";
import type { FightEvent } from "@/lib/types";
import { recommendVideos, type VideoRec } from "@/lib/feed/recommend";
import { SPORTS } from "@/lib/sports";

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
  /** Video the viewer's follows justify. Clamped hard — see below. */
  videos: VideoRec[];
}

// One video per 8 recommendations, matching the Following feed's clamp. The
// home rails are event-led by design; video is a garnish on them, and a
// recommendation surface that turns into a video wall stops being useful for
// the thing people came for.
const VIDEO_PER = 8;

const isFollowed = (e: FightEvent, promos: Set<string>, fighters: Set<string>): boolean =>
  (!!e.promotion && promos.has(resolvePromotion(e.promotion).slug)) ||
  e.fights.some((f) => fighters.has(f.red.id) || fighters.has(f.blue.id));

export async function getHomeSections(userId: string | null, upcomingIn?: FightEvent[]): Promise<HomeData> {
  // Reuse the caller's already-fetched list when provided (the home page fetches
  // upcoming events once and passes them here) — no duplicate query.
  const upcoming = upcomingIn ?? (await getUpcomingEvents());
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
      // Signed out there is no follow graph, so there is nothing explainable to
      // recommend — and an unexplained video is not shown anywhere else either.
      videos: [],
    };
  }

  const [pickRows, promoSlugs, fighterIds, progress, prefs] = await Promise.all([
    prisma.fightPick.findMany({ where: { userId }, select: { fight: { select: { eventId: true } } } }),
    getFollowedPromotionSlugs(userId),
    getFollowedFighterIds(userId),
    getProfileStats(userId),
    prisma.user.findUnique({ where: { id: userId }, select: { sportPrefs: true } }),
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

  // Density scales with how much this page actually shows.
  //
  // The denominator is the rails PLUS a floor, because the rails are only the
  // top of the home page — the hero, rankings, schedule, predictions, spotlight
  // and community sections all render below them. Measuring 1-per-8 against the
  // rails alone meant a user with two rails got zero videos forever, which is
  // the wrong end of the trade: the ceiling exists to stop video dominating,
  // not to make it invisible on exactly the pages that are already sparse.
  const railCount = live.length + continueWeek.length + becauseYouFollow.length + trending.length;
  const videoBudget = railCount >= 3 ? Math.max(1, Math.floor(railCount / VIDEO_PER)) : 0;
  const videos = videoBudget
    ? await recommendVideos({
        promotions: promoSlugs,
        disciplines: (prefs?.sportPrefs ?? []).flatMap((v) => {
          const slug = SPORTS.find((sp) => sp.value === v)?.slug;
          return slug ? [slug as string] : [];
        }),
        viewerId: userId,
        limit: videoBudget,
      })
    : [];

  return { personalized: true, live, continueWeek, becauseYouFollow, progress, trending, videos };
}
