import "server-only";
import { prisma } from "@/lib/db";
import { log } from "@/lib/scraper/logger";
import { notifyFollowers } from "./triggers";
import { publicDisplayName } from "@/lib/display-name";

// ════════════════════════════════════════════════════════════════════════════
//  "Someone you follow just did something." Milestones ONLY.
//
//  Person follows already live in UserFollow, and the follow target type "person"
//  routes to it — so this needs no new table, no new follow model and no new feed.
//
//  ── WHY THIS IS DELIBERATELY QUIET ────────────────────────────────────────
//  A person's ACTIONS are already recorded: recordActivity() writes an Activity row
//  for every pick, card and battle win, and the profile/homepage feeds read from it.
//  Fanning those out as notifications would mean a user who follows twenty people
//  receives a notification every time any of them makes a pick — the fastest way to
//  make the social category worthless, and a second copy of a feed that already
//  exists.
//
//  So Activity stays the source of truth for "what happened", and this sends only
//  the handful of facts a follower would genuinely want pushed to them. No rows are
//  duplicated: this writes Notification rows for OTHER people, never a second record
//  of the milestone itself.
// ════════════════════════════════════════════════════════════════════════════

/** Card rarities worth telling a follower about. A BASE card is a Tuesday. */
const NOTABLE_RARITIES = new Set(["EPIC", "CHAMPION", "LEGEND"]);

/** Streaks worth announcing. Not every increment — these are the ones people brag about. */
const STREAK_MILESTONES = [5, 10, 25, 50, 100] as const;

/** Reputation lines that are also worth telling FOLLOWERS about, not just the user. */
const COMMUNITY_MILESTONES = [1000, 2500, 5000, 10_000] as const;

async function personRef(userId: string) {
  return prisma.user.findUnique({
    where: { id: userId },
    select: { username: true, name: true },
  });
}

// publicDisplayName, because these notifications are read by OTHER PEOPLE. A raw
// `name` here would put the milestone-holder's email into every follower's bell.
const who = (p: { username: string | null; name: string | null } | null) =>
  p ? publicDisplayName(p) : "Someone you follow";

/** A person's public page, or the follow hub when they have no username yet. */
const personUrl = (p: { username: string | null } | null) => (p?.username ? `/u/${p.username}` : "/following");

/**
 * Fan a milestone out to the people who follow this user.
 *
 * One shape for all four milestone kinds so the fourth cannot forget the actor
 * exclusion or the preference check — both live in followerIdsToNotify, and the
 * "person" target maps to the social category.
 */
async function announce(
  userId: string,
  payload: { title: string; body: string; icon: string; dedupeKey: string; url?: string },
): Promise<number> {
  try {
    const person = await personRef(userId);
    return await notifyFollowers({ type: "person", id: userId }, {
      // COMMUNITY_REPLY maps to the "social" category — the same switch that governs
      // replies and new followers, which is where a user looks to turn this off.
      type: "COMMUNITY_REPLY",
      title: `${who(person)} ${payload.title}`,
      body: payload.body,
      url: payload.url ?? personUrl(person),
      icon: payload.icon,
      dedupeKey: payload.dedupeKey,
      // One person = one lit phone, however many milestones they hit in a night.
      tag: `person:${userId}`,
    }, { exclude: [userId] });
  } catch (e) {
    log.error({ op: "social.person", userId, err: (e as Error).message }, "milestone fan-out FAILED");
    return 0;
  }
}

/**
 * A rare card earned. Gated on rarity: the collection grows with every correct pick
 * and only the top tiers are news.
 */
export async function notifyCardMilestone(
  userId: string,
  input: { rarity: string; fighterName: string; cardId: string },
): Promise<number> {
  if (!NOTABLE_RARITIES.has(input.rarity.toUpperCase())) return 0;
  return announce(userId, {
    title: `pulled a ${input.rarity.toLowerCase()} card`,
    body: `${input.fighterName} — ${input.rarity.toLowerCase()} tier.`,
    icon: "card",
    // Per AWARD, so a re-run of the resolution engine cannot re-announce it.
    dedupeKey: `person_card:${input.cardId}`,
  });
}

/**
 * A prediction streak crossing a bragging line.
 *
 * Only upward crossings, and only the lines — a streak of 11 is not news when 10
 * already was. Keyed by the threshold per user, so a streak that breaks and is
 * rebuilt to the same number does not re-announce: the milestone is "reached 10",
 * which is true once.
 */
export async function notifyStreakMilestone(
  userId: string,
  before: number,
  after: number,
): Promise<number> {
  if (after <= before) return 0;
  const crossed = STREAK_MILESTONES.filter((m) => before < m && after >= m);
  if (!crossed.length) return 0;
  const top = crossed[crossed.length - 1];
  return announce(userId, {
    title: `is on a ${top}-pick streak`,
    body: `${top} correct calls in a row. Think you can read the card better?`,
    icon: "streak",
    dedupeKey: `person_streak:${userId}:${top}`,
  });
}

/**
 * A verified badge. The one milestone that changes how a follower reads everything
 * else the person says, so it goes out regardless of the other gates. Once ever.
 */
export async function notifyPersonVerified(userId: string, role: string): Promise<number> {
  return announce(userId, {
    title: "is now verified",
    body: `Verified ${role.toLowerCase()} on GlobalFight.`,
    icon: "verified",
    dedupeKey: `person_verified:${userId}`,
  });
}

/**
 * A community reputation milestone. Deliberately a HIGHER bar than the user's own
 * rep notification (which starts at 100): being told your own score crossed 100 is
 * encouragement, and telling twenty followers about it is noise.
 */
export async function notifyCommunityMilestone(
  userId: string,
  before: number,
  after: number,
): Promise<number> {
  if (after <= before) return 0;
  const crossed = COMMUNITY_MILESTONES.filter((m) => before < m && after >= m);
  if (!crossed.length) return 0;
  const top = crossed[crossed.length - 1];
  return announce(userId, {
    title: `passed ${top.toLocaleString()} reputation`,
    body: "One of the sharpest readers of a card in the community.",
    icon: "reputation",
    url: "/leaderboard",
    dedupeKey: `person_rep:${userId}:${top}`,
  });
}
