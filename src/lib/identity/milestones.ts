import "server-only";
import { prisma } from "@/lib/db";

// ── Collections ─────────────────────────────────────────────────────────────
// Humans finish things. A number with no target is a statistic; the same number
// with the next rung visible is a collection, and a collection is a reason to
// come back on a day with no card ("three more gyms and that's ten").
//
// Every ladder here is DERIVED from records the product already keeps — picks,
// follows, check-ins, reviews, cards, days. Nothing new is stored, so no
// milestone can ever disagree with the history that produced it, and none of it
// needs backfilling: a user who joined last year already has their real total.

export type LadderId =
  | "callsMade" | "callsCorrect" | "mainEvents" | "pickStreak"
  | "fightersFollowed" | "peopleFollowed"
  | "gymsVisited" | "eventsAttended" | "reviewsWritten"
  | "cardsCollected" | "battlesWon" | "daysActive";

export interface Ladder {
  id: LadderId;
  /** Pillar it belongs to — the UI groups by this. */
  group: "Predict" | "Connect" | "Train" | "Collect";
  title: string;
  /** Plural noun for the count: "42 gyms visited". */
  unit: string;
  tiers: readonly number[];
  /** Where to go to move this number. */
  href: string;
  /** What to actually do, in the imperative — an empty rung must never be a dead end. */
  cta: string;
}

// Tiers climb roughly ×2.5 so the next rung is always plausibly reachable and
// the last one takes years. The top rung of every ladder is deliberately a
// number a twenty-year member would hold, not a number a busy month would.
export const LADDERS: readonly Ladder[] = [
  { id: "callsMade", group: "Predict", title: "Calls made", unit: "fights called", tiers: [1, 10, 50, 150, 500, 1500], href: "/events", cta: "Call a fight on the next card" },
  { id: "callsCorrect", group: "Predict", title: "Calls landed", unit: "correct calls", tiers: [1, 10, 50, 150, 500], href: "/predictions/mine", cta: "Your open calls settle on fight night" },
  { id: "mainEvents", group: "Predict", title: "Main events", unit: "main events called", tiers: [1, 10, 25, 50, 100, 250], href: "/events", cta: "Call the next main event" },
  { id: "pickStreak", group: "Predict", title: "Best streak", unit: "in a row", tiers: [3, 5, 10, 15, 25], href: "/events", cta: "Start a new run" },
  { id: "fightersFollowed", group: "Connect", title: "Fighters followed", unit: "fighters followed", tiers: [1, 5, 20, 50, 150, 400], href: "/fighters", cta: "Follow a fighter you rate" },
  { id: "peopleFollowed", group: "Connect", title: "Your corner", unit: "people followed", tiers: [1, 5, 15, 40, 100], href: "/leaderboard", cta: "Follow a caller worth watching" },
  { id: "battlesWon", group: "Connect", title: "Battles won", unit: "battles won", tiers: [1, 5, 15, 40, 100], href: "/events", cta: "Take the other side of someone's call" },
  { id: "gymsVisited", group: "Train", title: "Gyms visited", unit: "gyms", tiers: [1, 3, 10, 25, 50], href: "/gyms", cta: "Check in where you train" },
  { id: "eventsAttended", group: "Train", title: "Events attended", unit: "events live", tiers: [1, 3, 10, 25, 50], href: "/events", cta: "Check in at a live card" },
  { id: "reviewsWritten", group: "Train", title: "Gyms reviewed", unit: "reviews written", tiers: [1, 3, 10, 25, 50], href: "/gyms", cta: "Review a gym you've trained at" },
  { id: "cardsCollected", group: "Collect", title: "Cards earned", unit: "cards", tiers: [1, 10, 50, 150, 500], href: "/collection", cta: "Cards drop when your calls land" },
  { id: "daysActive", group: "Collect", title: "Days here", unit: "days active", tiers: [7, 30, 100, 365, 1000, 3650], href: "/today", cta: "Show up tomorrow" },
] as const;

export interface LadderProgress extends Ladder {
  value: number;
  /** How many rungs are cleared. */
  earned: number;
  /** The rung just cleared, or null before the first. */
  current: number | null;
  /** The rung being climbed, or null when the ladder is complete. */
  next: number | null;
  /** 0–100 towards `next` (100 when complete). */
  pct: number;
  /** Units still needed for `next`. Zero when complete. */
  remaining: number;
  complete: boolean;
}

function progress(l: Ladder, value: number): LadderProgress {
  const earned = l.tiers.filter((t) => value >= t).length;
  const current = earned > 0 ? l.tiers[earned - 1] : null;
  const next = earned < l.tiers.length ? l.tiers[earned] : null;
  // Measure the rung being climbed from the PREVIOUS rung, not from zero —
  // 150→500 shown as "30%" when you are at 150 reads as losing progress.
  const floor = current ?? 0;
  const pct = next === null ? 100 : Math.max(0, Math.min(100, Math.round(((value - floor) / (next - floor)) * 100)));
  return {
    ...l,
    value,
    earned,
    current,
    next,
    pct,
    remaining: next === null ? 0 : Math.max(0, next - value),
    complete: next === null,
  };
}

export type MilestoneCounts = Record<LadderId, number>;

/** Every ladder for one user, in one parallel batch of counts. */
export async function getMilestones(userId: string): Promise<LadderProgress[]> {
  const [
    u, callsMade, mainEvents, fightersFollowed, peopleFollowed,
    gymsVisited, eventsAttended, reviewsWritten, cardsCollected,
  ] = await Promise.all([
    prisma.user.findUnique({
      where: { id: userId },
      select: { picksCorrect: true, bestPickStreak: true, battleWins: true, activeDays: true },
    }),
    prisma.fightPick.count({ where: { userId } }),
    prisma.fightPick.count({ where: { userId, fight: { mainEvent: true } } }),
    prisma.favoriteFighter.count({ where: { userId } }),
    prisma.userFollow.count({ where: { followerId: userId } }),
    // DISTINCT gyms/events, not check-in rows: training at one gym for ten years
    // is one gym visited, and counting the rows would make the number a lie.
    prisma.gym.count({ where: { checkIns: { some: { userId } } } }),
    prisma.event.count({ where: { checkIns: { some: { userId } } } }),
    prisma.gymReview.count({ where: { authorId: userId, deleted: false } }),
    prisma.cardAward.count({ where: { userId } }),
  ]);

  const counts: MilestoneCounts = {
    callsMade,
    callsCorrect: u?.picksCorrect ?? 0,
    mainEvents,
    pickStreak: u?.bestPickStreak ?? 0,
    fightersFollowed,
    peopleFollowed,
    battlesWon: u?.battleWins ?? 0,
    gymsVisited,
    eventsAttended,
    reviewsWritten,
    cardsCollected,
    daysActive: u?.activeDays ?? 0,
  };

  return LADDERS.map((l) => progress(l, counts[l.id]));
}

/**
 * The rungs worth putting in front of someone TODAY: closest to done first,
 * completed ladders dropped, and an untouched ladder ranked behind one already
 * under way (finishing beats starting). Ties break on the smaller gap.
 */
export function nearest(all: LadderProgress[], limit = 3): LadderProgress[] {
  return all
    .filter((l) => !l.complete)
    .sort((a, b) => {
      const started = (l: LadderProgress) => (l.value > 0 ? 0 : 1);
      return started(a) - started(b) || b.pct - a.pct || a.remaining - b.remaining;
    })
    .slice(0, limit);
}

/** Total rungs cleared — the one number that summarises a collection. */
export function totalEarned(all: LadderProgress[]): number {
  return all.reduce((s, l) => s + l.earned, 0);
}

export function totalRungs(): number {
  return LADDERS.reduce((s, l) => s + l.tiers.length, 0);
}
