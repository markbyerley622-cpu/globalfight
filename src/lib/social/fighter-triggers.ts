import "server-only";
import { prisma } from "@/lib/db";
import { log } from "@/lib/scraper/logger";
import { fanOut, notifyFollowers } from "./triggers";
import { cornerTargets, eventTargets, EVENT_REF_SELECT, type EventRef } from "./audience";

// ════════════════════════════════════════════════════════════════════════════
//  Fighter-centred triggers: what happens TO a fighter someone follows.
//
//  The dividing line against event-triggers.ts is the AUDIENCE, not the table.
//  "This card gained a bout" is news for the card's followers; "your fighter is
//  booked" is news for that fighter's followers. Same underlying Fight row, two
//  different facts, two different dedupe keys — which is exactly why a reader who
//  follows both hears each thing once and not twice.
//
//  Nothing here throws.
// ════════════════════════════════════════════════════════════════════════════

const boutUrl = (eventSlug: string, fightId: string) => `/events/${eventSlug}#fight-${fightId}`;

interface FightRef {
  id: string;
  redId: string;
  blueId: string;
  cancelled: boolean;
  date: Date;
  result: string;
  cardNote: string | null;
  red: { name: string };
  blue: { name: string };
  event: EventRef | null;
}

const FIGHT_REF_SELECT = {
  id: true, redId: true, blueId: true, cancelled: true, date: true, result: true, cardNote: true,
  red: { select: { name: true } },
  blue: { select: { name: true } },
  event: { select: EVENT_REF_SELECT },
} as const;

async function fightRef(fightId: string): Promise<FightRef | null> {
  return prisma.fight.findUnique({ where: { id: fightId }, select: FIGHT_REF_SELECT });
}

/** The state of a bout before a write, for the diff. Null when it is new. */
export interface FightSnapshot {
  id: string;
  cancelled: boolean;
  date: Date;
  eventId: string | null;
  result: string;
}

export async function snapshotFight(where: { id: string } | { slug: string }): Promise<FightSnapshot | null> {
  return prisma.fight.findUnique({
    where,
    select: { id: true, cancelled: true, date: true, eventId: true, result: true },
  });
}

/** A bout moved by less than this is a clock correction, not a reschedule. */
const RESCHEDULE_TOLERANCE_MS = 6 * 60 * 60 * 1000;

/**
 * A NEW bout — "your fighter is booked".
 *
 * Audience is the two corners' followers ONLY. The event's followers are told by
 * the card-level trigger, which counts the whole card rather than sending a row per
 * bout: a twelve-bout card landing in one ingest run must be one notification for a
 * card follower, and twelve people each hearing about their own fighter.
 */
export async function notifyFightAnnounced(fightId: string): Promise<number> {
  try {
    const fight = await fightRef(fightId);
    // A bout that arrives already decided is history being backfilled, not a
    // booking. Announcing "Usyk vs Fury is booked" for a fight from 2024 is the
    // single most obvious way to destroy trust in the whole category.
    if (!fight || !fight.event || fight.cancelled || fight.result !== "SCHEDULED") return 0;
    if (+fight.date < Date.now()) return 0;

    return await fanOut(cornerTargets(fight), {
      type: "FIGHT_ANNOUNCED",
      title: `${fight.red.name} vs ${fight.blue.name}`,
      body: `Booked for ${fight.event.name}.`,
      url: boutUrl(fight.event.slug, fight.id),
      icon: "🥊",
      dedupeKey: `fight_announced:${fight.id}`,
      tag: `event:${fight.event.id}`,
    });
  } catch (e) {
    log.error({ op: "social.fightAnnounced", fightId, err: (e as Error).message }, "fan-out FAILED");
    return 0;
  }
}

/**
 * A bout pulled from the card. The whole audience hears this one — both corners',
 * the event's and the promotion's — because someone who made a PICK on it needs to
 * know it is off, and the reason travels with it when an operator supplied one.
 */
export async function notifyFightCancelled(fightId: string): Promise<number> {
  try {
    const fight = await fightRef(fightId);
    if (!fight || !fight.event) return 0;

    return await fanOut([...cornerTargets(fight), ...eventTargets(fight.event)], {
      type: "FIGHT_ANNOUNCED",
      title: `${fight.red.name} vs ${fight.blue.name} is off`,
      // The cardNote is the operator's own words ("Jones out — injury"), which is
      // strictly better than anything generated here.
      body: fight.cardNote ?? `Pulled from ${fight.event.name}.`,
      url: boutUrl(fight.event.slug, fight.id),
      icon: "🚫",
      dedupeKey: `fight_cancelled:${fight.id}`,
      tag: `event:${fight.event.id}`,
    });
  } catch (e) {
    log.error({ op: "social.fightCancelled", fightId, err: (e as Error).message }, "fan-out FAILED");
    return 0;
  }
}

/** A bout moved to another date or another card. */
export async function notifyFightRescheduled(fightId: string): Promise<number> {
  try {
    const fight = await fightRef(fightId);
    if (!fight || !fight.event || fight.cancelled) return 0;

    return await fanOut([...cornerTargets(fight), ...eventTargets(fight.event)], {
      type: "FIGHT_ANNOUNCED",
      title: `${fight.red.name} vs ${fight.blue.name} has moved`,
      body: `Now on ${fight.event.name}.`,
      url: boutUrl(fight.event.slug, fight.id),
      icon: "🗓️",
      // Keyed by the destination: a bout moved twice is two facts.
      dedupeKey: `fight_rescheduled:${fight.id}:${fight.date.toISOString().slice(0, 10)}`,
      tag: `event:${fight.event.id}`,
    });
  } catch (e) {
    log.error({ op: "social.fightRescheduled", fightId, err: (e as Error).message }, "fan-out FAILED");
    return 0;
  }
}

/**
 * Diff a bout against its pre-write snapshot. One call at each write site rather
 * than three, so a path that handles cancellation cannot forget rescheduling.
 */
export async function notifyFightChanges(
  before: FightSnapshot | null,
  fightId: string,
): Promise<{ facts: string[] }> {
  const facts: string[] = [];
  try {
    const after = await snapshotFight({ id: fightId });
    if (!after) return { facts };

    if (!before) {
      if (await notifyFightAnnounced(fightId)) facts.push("announced");
      return { facts };
    }
    // Un-cancelling is a real operator action (a bout restored after a scare) and
    // is announced as a fresh booking — the reader was told it was off.
    if (before.cancelled && !after.cancelled) {
      if (await notifyFightAnnounced(fightId)) facts.push("restored");
    } else if (!before.cancelled && after.cancelled) {
      if (await notifyFightCancelled(fightId)) facts.push("cancelled");
    } else if (
      before.eventId !== after.eventId ||
      Math.abs(+after.date - +before.date) > RESCHEDULE_TOLERANCE_MS
    ) {
      if (await notifyFightRescheduled(fightId)) facts.push("rescheduled");
    }
    return { facts };
  } catch (e) {
    log.error({ op: "social.fightChanges", fightId, err: (e as Error).message }, "fight change fan-out FAILED");
    return { facts };
  }
}

// ── ranking movement ────────────────────────────────────────────────────────

/**
 * A fighter someone follows moved in the rankings.
 *
 * Only genuine, MEANINGFUL movement: entering the top 15, or moving at least two
 * places. Rankings are re-imported on a cron and a one-place shuffle after somebody
 * else's fight is noise — the fighter did nothing. Keyed by the destination rank, so
 * a fighter who bounces 5 → 4 → 5 announces the 4 once and never re-announces the 5.
 */
export async function notifyRankingChange(input: {
  fighterId: string;
  weightClass: string;
  rank: number;
  previousRank: number | null;
  isPoundForPound?: boolean;
}): Promise<number> {
  try {
    const { fighterId, weightClass, rank, previousRank } = input;
    const entered = previousRank === null;
    const moved = previousRank !== null ? previousRank - rank : 0;
    if (!entered && Math.abs(moved) < 2) return 0;
    // Entering at the very bottom of a long list is not a milestone.
    if (entered && rank > 15) return 0;

    const fighter = await prisma.fighter.findUnique({
      where: { id: fighterId },
      select: { slug: true, name: true },
    });
    if (!fighter) return 0;

    const division = input.isPoundForPound ? "pound-for-pound" : weightClass;
    const title = entered
      ? `${fighter.name} enters the ${division} rankings`
      : moved > 0
        ? `${fighter.name} climbs to #${rank}`
        : `${fighter.name} drops to #${rank}`;

    return await notifyFollowers({ type: "fighter", id: fighterId }, {
      // "predictions" category — rank movement lives in the same habit loop as
      // results and the leaderboard, and CATEGORY_OF already maps it there.
      type: "REP_MILESTONE",
      title,
      body: entered ? `Ranked #${rank} at ${division}.` : `${division} · was #${previousRank}.`,
      url: input.isPoundForPound ? "/p4p" : `/fighters/${fighter.slug}`,
      icon: entered ? "📈" : moved > 0 ? "⬆️" : "⬇️",
      dedupeKey: `rank:${fighterId}:${input.isPoundForPound ? "p4p" : weightClass}:${rank}`,
      tag: `fighter:${fighterId}`,
    });
  } catch (e) {
    log.error({ op: "social.rank", fighterId: input.fighterId, err: (e as Error).message }, "rank fan-out FAILED");
    return 0;
  }
}

// ── the profile itself ──────────────────────────────────────────────────────

/**
 * A fighter profile was CLAIMED and verified by its owner.
 *
 * The single most valuable follow notification there is: the person you follow is
 * now actually here. Once ever per fighter.
 */
export async function notifyFighterVerified(fighterId: string): Promise<number> {
  try {
    const fighter = await prisma.fighter.findUnique({
      where: { id: fighterId },
      select: { slug: true, name: true, claimed: true, ownerId: true },
    });
    if (!fighter?.claimed) return 0;

    return await fanOut([{ type: "fighter", id: fighterId }], {
      type: "FIGHT_ANNOUNCED",
      title: `${fighter.name} is verified`,
      body: "They've claimed their profile — it's them posting now.",
      url: `/fighters/${fighter.slug}`,
      icon: "✅",
      dedupeKey: `fighter_verified:${fighterId}`,
      tag: `fighter:${fighterId}`,
    }, { exclude: [fighter.ownerId] });
  } catch (e) {
    log.error({ op: "social.fighterVerified", fighterId, err: (e as Error).message }, "fan-out FAILED");
    return 0;
  }
}

/**
 * Fields whose change is worth telling a follower about.
 *
 * A short, explicit list — NOT "anything that changed". The enrichment pipeline
 * rewrites a dozen columns on this row every night (photos, licence metadata,
 * lastScrapedAt, denormalised record counts), and a notification per column is the
 * definition of spam. These four are things the fighter themself changed and a fan
 * would want to read.
 */
const PROFILE_FIELDS = ["tagline", "gym", "nickname", "instagram"] as const;
export type ProfileField = (typeof PROFILE_FIELDS)[number];

/**
 * A fighter updated something meaningful about themselves.
 *
 * Only fires for a CLAIMED profile — an unclaimed one changing is a scraper
 * correcting itself, which is maintenance, not news. Keyed per field per value, so
 * an edit war cannot buzz a follower repeatedly.
 */
export async function notifyFighterProfileUpdate(
  fighterId: string,
  changed: Partial<Record<ProfileField, string | null>>,
): Promise<number> {
  try {
    const fields = PROFILE_FIELDS.filter((f) => f in changed && changed[f]);
    if (!fields.length) return 0;

    const fighter = await prisma.fighter.findUnique({
      where: { id: fighterId },
      select: { slug: true, name: true, claimed: true, ownerId: true },
    });
    if (!fighter?.claimed) return 0;

    const field = fields[0];
    const value = changed[field] ?? "";
    const copy: Record<ProfileField, string> = {
      tagline: `“${value}”`,
      gym: `Now training at ${value}.`,
      nickname: `Now fighting as “${value}”.`,
      instagram: "Added their Instagram.",
    };

    return await fanOut([{ type: "fighter", id: fighterId }], {
      type: "FIGHT_ANNOUNCED",
      title: `${fighter.name} updated their profile`,
      body: copy[field],
      url: `/fighters/${fighter.slug}`,
      icon: "📝",
      dedupeKey: `fighter_profile:${fighterId}:${field}:${value.slice(0, 40)}`,
      tag: `fighter:${fighterId}`,
    }, { exclude: [fighter.ownerId] });
  } catch (e) {
    log.error({ op: "social.fighterProfile", fighterId, err: (e as Error).message }, "fan-out FAILED");
    return 0;
  }
}
