import "server-only";
import { prisma } from "@/lib/db";
import { touchDailyStreak, type StreakState } from "@/lib/identity/streak";
import { getMilestones, nearest, totalEarned, totalRungs, type LadderProgress } from "@/lib/identity/milestones";

// ── Today ───────────────────────────────────────────────────────────────────
// The answer to "why would I open this on a Tuesday".
//
// Every other surface in the product is organised around an EVENT: the card,
// the bout, the result. Those are moments. This one is organised around a
// PERSON, and it is built entirely from things that move between fights —
// a rank shifting, a fighter you follow getting booked, someone in your corner
// making a call, your gym filling up, a rung you are three away from.
//
// Two lists, deliberately separate:
//   · `changed`  what moved while you were away — the reason to look
//   · `act`      what you can do right now — the reason to stay
// A digest without the second half is a newsletter.
//
// Cost discipline: every read below is bounded by a `take` and keyed on an
// index, so this page costs the same for a user following four hundred
// fighters as for one following four.

const MAX_FOLLOWS = 400; // ids fed into `in` filters
const WINDOW_CAP_DAYS = 30; // longest "since you were last here" we will look back
const DEFAULT_WINDOW_DAYS = 3; // first-ever visit: show the last few days, not nothing

export type ItemKind = "settled" | "announced" | "rankmove" | "corner" | "gym" | "act";
export type ItemTone = "win" | "loss" | "act" | "neutral";

export interface TodayItem {
  id: string;
  kind: ItemKind;
  title: string;
  detail: string | null;
  href: string | null;
  when: Date;
  tone: ItemTone;
}

export interface TodayBriefing {
  streak: StreakState;
  /** Start of the "what changed" window. */
  since: Date;
  /** True when this account has never had a recorded visit before now. */
  firstVisit: boolean;
  changed: TodayItem[];
  act: TodayItem[];
  /**
   * How many fighters this user follows. The act/digest empty states read very
   * differently for "you follow nobody" and "nobody you follow is fighting
   * soon", and telling the first group that "every fighter you follow is
   * called" is a claim about an empty set.
   */
  followedFighters: number;
  /** Every ladder, for the collections board. */
  allMilestones: LadderProgress[];
  /** The three worth putting in front of them today. */
  milestones: LadderProgress[];
  milestonesEarned: number;
  milestonesTotal: number;
  /** Reputation earned in the last 7 days — movement, not a lifetime total. */
  repWeek: number;
  reputation: number;
  rank: number | null;
}

const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000);

/** Clamp the digest window: never before the cap, never after now. */
function windowStart(previousActiveOn: Date | null): Date {
  const floor = daysAgo(WINDOW_CAP_DAYS);
  if (!previousActiveOn) return daysAgo(DEFAULT_WINDOW_DAYS);
  return previousActiveOn > floor ? previousActiveOn : floor;
}

const cornerName = (c: string) => (c === "RED" ? "red" : "blue");

export async function getTodayBriefing(userId: string): Promise<TodayBriefing> {
  // Touch FIRST so the visit is recorded even if a later read fails, and so the
  // returned state carries the pre-visit day to build the window from.
  const streak = await touchDailyStreak(userId);
  const since = windowStart(streak.previousActiveOn);
  const now = new Date();
  const soon = new Date(now.getTime() + 14 * 86_400_000);

  const [follows, peopleIds] = await Promise.all([
    prisma.favoriteFighter.findMany({
      where: { userId },
      select: { fighterId: true },
      orderBy: { createdAt: "desc" },
      take: MAX_FOLLOWS,
    }),
    prisma.userFollow.findMany({
      where: { followerId: userId },
      select: { followingId: true },
      orderBy: { createdAt: "desc" },
      take: MAX_FOLLOWS,
    }),
  ]);
  const fighterIds = follows.map((f) => f.fighterId);
  const followedUserIds = peopleIds.map((p) => p.followingId);
  const followsFighters = fighterIds.length > 0;

  const [
    settled, announced, rankMoves, cornerActivity, homeGym,
    unpicked, repAgg, me, milestones,
  ] = await Promise.all([
    // 1 — your calls that were graded while you were away. The single most
    // personal thing that can happen in this product.
    prisma.fightPick.findMany({
      where: { userId, correct: { not: null }, updatedAt: { gte: since } },
      orderBy: { updatedAt: "desc" },
      take: 6,
      select: {
        corner: true, correct: true, updatedAt: true, fightId: true,
        fight: {
          select: {
            slug: true, red: { select: { name: true } }, blue: { select: { name: true } },
            event: { select: { name: true } },
          },
        },
      },
    }),
    // 2 — fighters you follow, newly booked. Career tracking: the thing that
    // happens on a Tuesday.
    followsFighters
      ? prisma.fight.findMany({
          where: {
            createdAt: { gte: since },
            date: { gte: now },
            OR: [{ redId: { in: fighterIds } }, { blueId: { in: fighterIds } }],
          },
          orderBy: { date: "asc" },
          take: 5,
          select: {
            id: true, slug: true, date: true, titleFight: true, createdAt: true,
            red: { select: { id: true, name: true } },
            blue: { select: { id: true, name: true } },
            event: { select: { name: true } },
          },
        })
      : Promise.resolve([]),
    // 3 — rankings moving under fighters you follow.
    followsFighters
      ? prisma.ranking.findMany({
          where: { fighterId: { in: fighterIds }, movement: { in: ["UP", "DOWN", "NEW", "RETURN"] }, updatedAt: { gte: since } },
          orderBy: { updatedAt: "desc" },
          take: 5,
          select: {
            id: true, rank: true, previousRank: true, movement: true, updatedAt: true, isPoundForPound: true,
            fighter: { select: { name: true, slug: true } },
            weightClass: { select: { name: true } },
          },
        })
      : Promise.resolve([]),
    // 4 — your corner: what the people you follow have been doing.
    followedUserIds.length
      ? prisma.activity.findMany({
          where: { userId: { in: followedUserIds }, createdAt: { gte: since } },
          orderBy: { createdAt: "desc" },
          take: 6,
          select: {
            id: true, title: true, url: true, createdAt: true,
            user: { select: { name: true, username: true } },
          },
        })
      : Promise.resolve([]),
    // 5 — your home gym, right now. Local combat: the only section here that is
    // about a room rather than a broadcast.
    prisma.gymMember.findFirst({
      where: { userId },
      orderBy: [{ isHome: "desc" }, { createdAt: "asc" }],
      select: { gym: { select: { id: true, slug: true, name: true } } },
    }),
    // 6 — ACT: fights involving fighters you follow that you have not called.
    followsFighters
      ? prisma.fight.findMany({
          where: {
            date: { gte: now, lte: soon },
            result: "SCHEDULED",
            OR: [{ redId: { in: fighterIds } }, { blueId: { in: fighterIds } }],
            picks: { none: { userId } },
          },
          orderBy: { date: "asc" },
          take: 3,
          select: {
            id: true, slug: true, date: true,
            red: { select: { name: true } }, blue: { select: { name: true } },
            event: { select: { name: true } },
          },
        })
      : Promise.resolve([]),
    prisma.reputationEvent.aggregate({ where: { userId, createdAt: { gte: daysAgo(7) } }, _sum: { delta: true } }),
    prisma.user.findUnique({ where: { id: userId }, select: { reputation: true, picksResolved: true } }),
    getMilestones(userId),
  ]);

  const rank = me && me.picksResolved > 0
    ? (await prisma.user.count({ where: { picksResolved: { gt: 0 }, reputation: { gt: me.reputation } } })) + 1
    : null;

  // Gym pulse is one extra read, and only for members — a non-member pays
  // nothing for a section they will never see.
  let gymItem: TodayItem | null = null;
  if (homeGym?.gym) {
    const here = await prisma.checkIn.count({ where: { gymId: homeGym.gym.id, expiresAt: { gt: now } } });
    if (here > 0) {
      gymItem = {
        id: `gym:${homeGym.gym.id}`,
        kind: "gym",
        title: `${here} training at ${homeGym.gym.name} right now`,
        detail: "Check in and they'll see you're on the mats.",
        href: `/gyms/${homeGym.gym.slug}`,
        when: now,
        tone: "act",
      };
    }
  }

  const changed: TodayItem[] = [
    ...settled.map((p): TodayItem => ({
      id: `pick:${p.fightId}`,
      kind: "settled",
      title: p.correct
        ? `You called ${p.corner === "RED" ? p.fight.red.name : p.fight.blue.name} — and they got it done`
        : `${p.corner === "RED" ? p.fight.red.name : p.fight.blue.name} didn't land it`,
      detail: [p.fight.event?.name, `your ${cornerName(p.corner)}-corner call`].filter(Boolean).join(" · "),
      href: `/fights/${p.fight.slug}`,
      when: p.updatedAt,
      tone: p.correct ? "win" : "loss",
    })),
    ...announced.map((f): TodayItem => {
      const mine = fighterIds.includes(f.red.id) ? f.red.name : f.blue.name;
      return {
        id: `booked:${f.id}`,
        kind: "announced",
        title: `${mine} is booked${f.titleFight ? " — for a title" : ""}`,
        detail: [`${f.red.name} vs ${f.blue.name}`, f.event?.name].filter(Boolean).join(" · "),
        href: `/fights/${f.slug}`,
        when: f.createdAt,
        tone: "neutral",
      };
    }),
    ...rankMoves.map((r): TodayItem => {
      const div = r.isPoundForPound ? "pound-for-pound" : r.weightClass.name;
      const moved = r.movement === "UP" ? "up to" : r.movement === "DOWN" ? "down to" : r.movement === "RETURN" ? "back in at" : "enters at";
      const from = r.previousRank && r.movement !== "NEW" ? ` from #${r.previousRank}` : "";
      return {
        id: `rank:${r.id}`,
        kind: "rankmove",
        title: `${r.fighter.name} ${moved} #${r.rank}${from}`,
        detail: div,
        href: `/fighters/${r.fighter.slug}`,
        when: r.updatedAt,
        tone: r.movement === "DOWN" ? "loss" : "win",
      };
    }),
    ...cornerActivity.map((a): TodayItem => ({
      id: `act:${a.id}`,
      kind: "corner",
      title: `${a.user.name ?? `@${a.user.username ?? "someone"}`} — ${a.title}`,
      detail: a.user.username ? `@${a.user.username}` : null,
      href: a.url ?? (a.user.username ? `/u/${a.user.username}` : null),
      when: a.createdAt,
      tone: "neutral",
    })),
  ].sort((a, b) => b.when.getTime() - a.when.getTime());

  const act: TodayItem[] = [
    ...unpicked.map((f): TodayItem => ({
      id: `call:${f.id}`,
      kind: "act",
      title: `You haven't called ${f.red.name} vs ${f.blue.name}`,
      detail: [f.event?.name, f.date.toLocaleDateString(undefined, { day: "numeric", month: "short" })].filter(Boolean).join(" · "),
      href: `/predictions/${f.slug}`,
      when: f.date,
      tone: "act",
    })),
    ...(gymItem ? [gymItem] : []),
  ];

  return {
    streak,
    since,
    firstVisit: streak.previousActiveOn === null,
    changed: changed.slice(0, 12),
    act,
    followedFighters: fighterIds.length,
    allMilestones: milestones,
    milestones: nearest(milestones, 3),
    milestonesEarned: totalEarned(milestones),
    milestonesTotal: totalRungs(),
    repWeek: repAgg._sum.delta ?? 0,
    reputation: me?.reputation ?? 0,
    rank,
  };
}
