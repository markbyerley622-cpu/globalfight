import "server-only";
import type { Prisma, ActivityType } from "@prisma/client";
import { prisma } from "@/lib/db";

// ════════════════════════════════════════════════════════════════════════════
//  THE ACTIVITY DOMAIN — every emitter, in one file.
//
//  ── The problem this fixes ───────────────────────────────────────────────
//  The Activity table and `recordActivity` already existed, and the enum
//  declared seven kinds. Only THREE were ever written: PICK_CORRECT,
//  CARD_EARNED and BATTLE_WON. PICK_MADE, FOLLOW, THREAD_CREATED and
//  REP_MILESTONE were declared and emitted by nothing.
//
//  All three that did fire are POST-RESOLUTION events, so a member's feed stayed
//  completely empty until a fight they called finished — days or weeks after
//  they joined. The feed that exists to make a profile look alive was, for every
//  new user, blank.
//
//  ── Why the emitters live here and not at the call sites ─────────────────
//  Each of these writes one sentence and one URL, and those are the things that
//  drift: the same event phrased three ways from three modules. Keeping them
//  together means the feed reads consistently, and adding a kind is a function
//  here rather than an ad-hoc `prisma.activity.create` somewhere in a service.
//
//  ── Non-fatal, always ────────────────────────────────────────────────────
//  A feed row is a nice-to-have. Nothing in this file may ever break the action
//  that triggered it: a failure to log "you locked a pick" must not fail the
//  pick. Every emitter swallows its own errors.
// ════════════════════════════════════════════════════════════════════════════

type Db = Prisma.TransactionClient | typeof prisma;

interface EmitInput {
  type: ActivityType;
  /** The rendered sentence. Resolved at write time — see the schema note. */
  title: string;
  url?: string | null;
  meta?: Prisma.InputJsonValue;
}

/**
 * The single write. Everything below funnels through it.
 *
 * `db` is a transaction client when the caller has one, so the row commits or
 * rolls back with the thing it describes — a "pick locked" entry for a pick that
 * failed to save would be a lie in someone's public history.
 */
export async function emitActivity(db: Db, userId: string, input: EmitInput): Promise<void> {
  try {
    await db.activity.create({
      data: {
        userId,
        type: input.type,
        title: input.title,
        url: input.url ?? null,
        meta: input.meta ?? undefined,
      },
    });
  } catch {
    // Never fatal. See the header.
  }
}

// ── Predictions ─────────────────────────────────────────────────────────────

/**
 * A call was locked, or moved to the other corner.
 *
 * THE most important emitter in the file: it is the only one that fires at the
 * moment a member acts, rather than when a fight resolves later. Without it a
 * new account has an empty feed for as long as it takes their first pick to
 * settle, which is exactly when a profile most needs to look alive.
 */
export async function activityPickMade(
  db: Db,
  userId: string,
  o: { fightSlug: string; eventSlug?: string | null; fighterName: string; finish?: string | null; changed: boolean },
): Promise<void> {
  const where = o.eventSlug ? `/events/${o.eventSlug}#fight-${o.fightSlug}` : `/fights/${o.fightSlug}`;
  const how = o.finish ? ` by ${o.finish}` : "";
  await emitActivity(db, userId, {
    type: o.changed ? "PICK_CHANGED" : "PICK_MADE",
    title: o.changed ? `Switched to ${o.fighterName}${how}` : `Locked ${o.fighterName}${how}`,
    url: where,
    meta: { fightSlug: o.fightSlug, finish: o.finish ?? null },
  });
}

/** A settled call that did NOT land. The counterpart to PICK_CORRECT. */
export async function activityPickMissed(
  db: Db,
  userId: string,
  o: { fightSlug: string; winnerName: string; url: string },
): Promise<void> {
  await emitActivity(db, userId, {
    type: "PICK_MISSED",
    // Phrased as the OUTCOME, not as a failure. A feed that says "got it wrong"
    // twelve times is a feed people hide.
    title: `Called it — ${o.winnerName} took it`,
    url: o.url,
    meta: { fightSlug: o.fightSlug },
  });
}

// ── Reputation ──────────────────────────────────────────────────────────────

/**
 * A reputation MILESTONE, not every point.
 *
 * Emitting on every delta would bury the feed under +12s and make it unreadable;
 * the caller decides what counts as a milestone (see reputation.ts, which
 * already has that concept and already refuses to re-announce one you drop back
 * below).
 */
export async function activityRepMilestone(
  db: Db,
  userId: string,
  o: { reputation: number; username?: string | null },
): Promise<void> {
  await emitActivity(db, userId, {
    type: "REP_MILESTONE",
    title: `Passed ${o.reputation.toLocaleString()} reputation`,
    url: o.username ? `/u/${o.username}` : "/leaderboard",
    meta: { reputation: o.reputation },
  });
}

// ── Social graph ────────────────────────────────────────────────────────────

/** One member followed another. Written for the FOLLOWER — it is their action. */
export async function activityFollowed(
  db: Db,
  followerId: string,
  o: { targetName: string; targetUsername: string },
): Promise<void> {
  await emitActivity(db, followerId, {
    type: "FOLLOW",
    title: `Followed ${o.targetName}`,
    url: `/u/${o.targetUsername}`,
    meta: { username: o.targetUsername },
  });
}

// ── Challenges ──────────────────────────────────────────────────────────────

export async function activityChallenge(
  db: Db,
  userId: string,
  o: { accepted: boolean; opponentName: string; opponentUsername: string | null; fightSlug: string },
): Promise<void> {
  await emitActivity(db, userId, {
    type: o.accepted ? "CHALLENGE_ACCEPTED" : "CHALLENGE_SENT",
    title: o.accepted ? `Took on ${o.opponentName}` : `Challenged ${o.opponentName}`,
    url: `/fights/${o.fightSlug}`,
    meta: { opponent: o.opponentUsername, fightSlug: o.fightSlug },
  });
}

// ── Discussion ──────────────────────────────────────────────────────────────

/**
 * A thread or a reply.
 *
 * Deliberately NOT emitted for battle-room posts: those threads are private
 * between two rivals, and a public feed row pointing at one would leak both its
 * existence and its URL. The caller passes `visibility` and this refuses.
 */
export async function activityPosted(
  db: Db,
  userId: string,
  o: { isThread: boolean; title: string; url: string; visibility?: string },
): Promise<void> {
  if (o.visibility && o.visibility !== "public") return;
  await emitActivity(db, userId, {
    type: o.isThread ? "THREAD_CREATED" : "POST_CREATED",
    title: o.isThread ? `Started “${trim(o.title)}”` : `Replied in “${trim(o.title)}”`,
    url: o.url,
  });
}

/** Thread titles are user input and can be long; a feed row is one line. */
const trim = (s: string, max = 60) => (s.length > max ? `${s.slice(0, max - 1)}…` : s);
