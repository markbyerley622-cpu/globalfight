import "server-only";
import { prisma } from "@/lib/db";
import { notifyMany } from "@/lib/notifications-store";
import { followerIdsToNotify, type FollowTarget } from "@/lib/follow-targets";
import { log } from "@/lib/scraper/logger";
import { EVENT_REF_SELECT, fightTargets } from "./audience";
import type { NotificationType } from "@prisma/client";

// ════════════════════════════════════════════════════════════════════════════
//  Follower fan-out — ONE function every trigger goes through.
//
//  The gym review pipeline proved the shape: resolve followers, drop the actor,
//  apply preferences, then hand the batch to the EXISTING store, which already
//  owns dedupe, push policy and the unread count. Every other trigger — a fight
//  result, a new event, a cancellation — is the same operation with different copy.
//
//  Writing them as one function rather than fifteen is what stops the fifteenth
//  quietly forgetting the preference check or the actor exclusion.
//
//  It NEVER throws. A notification is a consequence of something that already
//  happened; failing to send one must not roll back the thing itself. Same rule
//  settlement follows for results.
// ════════════════════════════════════════════════════════════════════════════

export interface FanOutPayload {
  type: NotificationType;
  title: string;
  body?: string;
  /** The exact destination. A notification that lands on a generic page is a dead end. */
  url: string;
  icon?: string;
  /**
   * Once-ever key. Two triggers describing the same real-world fact — a result
   * reaching the fighter's followers AND the event's — must not arrive twice, so
   * the key describes the FACT, not the trigger that noticed it.
   */
  dedupeKey?: string;
  /** Collapses the phone notification; the in-app rows still all land. */
  tag?: string;
}

/** Fan a payload out to everyone following `target`. Returns how many were told. */
export async function notifyFollowers(
  target: FollowTarget,
  payload: FanOutPayload,
  opts: { exclude?: (string | null | undefined)[] } = {},
): Promise<number> {
  return fanOut([target], payload, opts);
}

/**
 * Fan ONE payload out across SEVERAL targets — the shape almost every trigger
 * actually wants.
 *
 * The audiences are unioned in memory before a single row is written, so a reader
 * following the fighter AND the event AND the promotion is one entry in one insert
 * rather than three inserts the database has to reject two of. The (userId,
 * dedupeKey) unique is still the guarantee; this just stops us relying on it for
 * the common case.
 *
 * ONE insert and ONE push for the whole audience, however many targets it spans.
 */
export async function fanOut(
  targets: FollowTarget[],
  payload: FanOutPayload,
  opts: { exclude?: (string | null | undefined)[] } = {},
): Promise<number> {
  if (!targets.length) return 0;
  try {
    // Per target: one query for followers, one for their preferences. Never one
    // per follower — a promotion with 5,000 followers must not be 5,000 lookups.
    const perTarget = await Promise.all(targets.map((t) => followerIdsToNotify(t, opts)));
    const userIds = [...new Set(perTarget.flat())];
    if (!userIds.length) return 0;

    const sent = await notifyMany(userIds, payload);
    if (sent) {
      log.info(
        { op: "social.fanout", targets: targets.map((t) => t.type).join("+"), audience: userIds.length, sent, type: payload.type },
        "followers notified",
      );
    }
    return sent;
  } catch (e) {
    log.error({ op: "social.fanout", targets: targets.map((t) => t.type).join("+"), err: (e as Error).message }, "fan-out FAILED");
    return 0;
  }
}

/**
 * A decided bout, announced to everyone with a reason to care: both fighters'
 * followers, the event's followers, and the promotion's.
 *
 * ONE dedupeKey across all four audiences. A reader following Anthony Joshua AND the
 * event AND the promotion is one person who wants one notification, not three — and
 * the (userId, dedupeKey) unique is what enforces that, rather than each trigger
 * hoping the others stayed quiet.
 */
export async function notifyFightResult(fightId: string): Promise<{ notified: number }> {
  try {
    const fight = await prisma.fight.findUnique({
      where: { id: fightId },
      select: {
        id: true, result: true, winnerId: true, method: true, roundEnded: true,
        redId: true, blueId: true,
        red: { select: { name: true } },
        blue: { select: { name: true } },
        event: { select: EVENT_REF_SELECT },
      },
    });
    if (!fight || fight.result === "SCHEDULED" || !fight.event) return { notified: 0 };

    const winner =
      fight.winnerId === fight.redId ? fight.red.name
        : fight.winnerId === fight.blueId ? fight.blue.name
          : null;
    const loser =
      fight.winnerId === fight.redId ? fight.blue.name
        : fight.winnerId === fight.blueId ? fight.red.name
          : null;

    const title = winner ? `${winner} def. ${loser}` : `${fight.red.name} vs ${fight.blue.name} — ${fight.result === "DRAW" ? "draw" : "no contest"}`;
    const detail = [fight.method, fight.roundEnded ? `R${fight.roundEnded}` : null].filter(Boolean).join(" · ");

    const notified = await fanOut(fightTargets(fight), {
      type: "PICK_RESULT",
      title,
      body: detail ? `${fight.event.name} · ${detail}` : fight.event.name,
      // Deep link into the BOUT on the event page, not the event — the reader came
      // for this result, and the module opens itself on the #fight- hash.
      url: `/events/${fight.event.slug}#fight-${fight.id}`,
      icon: "🏆",
      // The FACT is "this bout has a result", so every audience shares one key.
      dedupeKey: `fight_result:${fight.id}`,
      tag: `event:${fight.event.id}`,
    });
    return { notified };
  } catch (e) {
    log.error({ op: "social.fightResult", fightId, err: (e as Error).message }, "result fan-out FAILED");
    return { notified: 0 };
  }
}
