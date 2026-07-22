import "server-only";
import { prisma } from "@/lib/db";
import { awardReputation, pickReputation } from "@/lib/reputation";
import { notify } from "@/lib/notifications-store";
import { recordActivity } from "@/lib/activity";
import { awardCard, rarityForFight } from "@/lib/collectibles";
import { resolveFightBattles } from "@/lib/battles";

// ════════════════════════════════════════════════════════════════════════════
//  Combat Intelligence Engine — the resolution pipeline.
//
//  When a bout is decided this grades every pick and fans the consequences into
//  the shared systems, deterministically and idempotently:
//
//    grade pick → update stats/streak → award reputation → earn collectible
//                → notify → record activity
//
//  Idempotency: each pick is graded only while `correct IS NULL`, and the fight
//  is stamped `picksResolvedAt` when done — so re-runs are safe no-ops. Each
//  pick's fan-out is wrapped in its own transaction: one user's payout can't
//  half-apply, and one failure doesn't poison the rest of the card.
// ════════════════════════════════════════════════════════════════════════════

type LoadedFight = NonNullable<Awaited<ReturnType<typeof loadFight>>>;

function loadFight(fightId: string) {
  return prisma.fight.findUnique({
    where: { id: fightId },
    include: {
      red: { select: { id: true, slug: true, name: true } },
      blue: { select: { id: true, slug: true, name: true } },
      event: { select: { slug: true } },
      picks: { where: { correct: null } },
    },
  });
}

/** Winning corner, robust to winnerId being stored as a Fighter id OR slug. */
function winnerCorner(f: LoadedFight): "RED" | "BLUE" | null {
  if (f.result !== "WIN" || !f.winnerId) return null;
  const w = f.winnerId;
  if (w === f.redId || w === f.red.slug) return "RED";
  if (w === f.blueId || w === f.blue.slug) return "BLUE";
  return null;
}

export async function resolveFightPicks(fightId: string): Promise<{ resolved: number }> {
  const fight = await loadFight(fightId);
  if (!fight || fight.result === "SCHEDULED") return { resolved: 0 };
  if (fight.picks.length === 0) {
    // Nothing to grade — resolve any battles (a re-run may still have open ones),
    // then stamp so the due-query stops selecting it.
    await resolveFightBattles(fightId, winnerCorner(fight));
    if (!fight.picksResolvedAt) await prisma.fight.update({ where: { id: fightId }, data: { picksResolvedAt: new Date() } });
    return { resolved: 0 };
  }

  const corner = winnerCorner(fight);
  const decisive = corner !== null; // draw / no-contest ⇒ picks voided, no payout
  const winnerFighterId = corner === "RED" ? fight.redId : corner === "BLUE" ? fight.blueId : null;
  const winnerName = corner === "RED" ? fight.red.name : corner === "BLUE" ? fight.blue.name : null;
  // Deep-link the reward straight into THIS bout's arena on the event page (the
  // module opens itself on a #fight-<slug> hash), falling back to the bout
  // redirect for the rare orphan fight with no event.
  const boutUrl = fight.event ? `/events/${fight.event.slug}#fight-${fight.slug}` : `/predictions/${fight.slug}`;
  const rarity = rarityForFight(fight);

  // Upset factor = the share of the crowd that got this bout WRONG, read from the
  // full pick set at resolution. It scales the reputation reward so calling an
  // obvious favourite pays the floor and calling a genuine upset pays far more —
  // the anti-farming lever. 0.5 when nobody picked (neutral).
  const onWinner = decisive ? fight.picks.filter((p) => p.corner === corner).length : 0;
  const upsetFactor = decisive && fight.picks.length > 0 ? 1 - onWinner / fight.picks.length : 0.5;

  let resolved = 0;
  for (const pick of fight.picks) {
    const correct = decisive && pick.corner === corner;

    await prisma.$transaction(async (tx) => {
      await tx.fightPick.update({
        where: { userId_fightId: { userId: pick.userId, fightId } },
        data: { correct: decisive ? correct : false },
      });

      if (!decisive) return; // void bout: mark graded, no stats/rep/notify

      const user = await tx.user.update({
        where: { id: pick.userId },
        data: {
          picksResolved: { increment: 1 },
          ...(correct
            ? { picksCorrect: { increment: 1 }, pickStreak: { increment: 1 } }
            : { pickStreak: { set: 0 } }),
        },
        select: { pickStreak: true, bestPickStreak: true },
      });

      if (correct) {
        if (user.pickStreak > user.bestPickStreak) {
          await tx.user.update({ where: { id: pick.userId }, data: { bestPickStreak: user.pickStreak } });
        }
        const rep = pickReputation({ upsetFactor, confidence: pick.confidence, streak: user.pickStreak });
        await awardReputation(tx, pick.userId, rep, "pick_correct", { type: "fight", id: fightId });

        if (winnerFighterId) {
          await awardCard(tx, pick.userId, winnerFighterId, { rarity, reason: "correct_pick", fightId });
          await recordActivity(tx, pick.userId, { type: "CARD_EARNED", title: `Earned a ${rarity.toLowerCase()} ${winnerName} card`, url: boutUrl });
        }
        await recordActivity(tx, pick.userId, { type: "PICK_CORRECT", title: `Correctly picked ${winnerName}`, url: boutUrl });
        await notify(tx, pick.userId, {
          type: "PICK_RESULT",
          title: `You called it — ${winnerName} won`,
          body: `+${rep} reputation · ${user.pickStreak}-pick streak${winnerFighterId ? ` · ${rarity.toLowerCase()} card earned` : ""}`,
          url: boutUrl,
          icon: "✅",
          // One card = one lit phone. The device replaces the previous bout's
          // push instead of stacking twelve; all twelve rows still land in the
          // in-app list, where re-reading them is the point.
          tag: fight.eventId ? `picks:${fight.eventId}` : undefined,
        });
      } else {
        await notify(tx, pick.userId, {
          type: "PICK_RESULT",
          title: `Tough one — ${winnerName ?? "the other corner"} took it`,
          body: `Your pick didn't land — streak reset.`,
          url: boutUrl,
          icon: "❌",
          tag: fight.eventId ? `picks:${fight.eventId}` : undefined,
        });
      }
    });

    resolved += 1;
  }

  // The fight is the referee: resolve every open battle on this bout now that each
  // side's pick is graded (winner = whoever's FightPick landed). Idempotent.
  await resolveFightBattles(fightId, corner);

  await prisma.fight.update({ where: { id: fightId }, data: { picksResolvedAt: new Date() } });

  // If that was the last graded bout on the card, close the loop with one
  // scoreline. Best-effort: the payouts above are the real work.
  if (fight.eventId) await notifyCardSummary(fight.eventId).catch(() => {});

  return { resolved };
}

/**
 * "You went 7 of 12 on UFC 300" — sent once, when the final bout with picks on
 * a card has been graded.
 *
 * The per-fight notifications above are the live drip and stay: people want to
 * know the moment their pick lands. But a card is the unit people actually keep
 * score in, and a twelve-bout night otherwise ends with twelve fragments and no
 * total. This is the one that says how the night went.
 *
 * Void bouts are excluded, exactly as they are from the user's own
 * picksResolved counter — a no-contest is not a miss, and a scoreline that
 * disagrees with the profile page is worse than no scoreline.
 */
async function notifyCardSummary(eventId: string): Promise<void> {
  // Anything still ungraded means the card isn't done. Cheap, indexed, and the
  // guard that makes this run exactly once per event.
  const pending = await prisma.fight.count({
    where: { eventId, picksResolvedAt: null, picks: { some: {} } },
  });
  if (pending > 0) return;

  const event = await prisma.event.findUnique({ where: { id: eventId }, select: { slug: true, name: true } });
  if (!event) return;

  const scored = { fight: { eventId, result: "WIN" as const } };
  const [totals, hits] = await Promise.all([
    prisma.fightPick.groupBy({ by: ["userId"], where: { ...scored, correct: { not: null } }, _count: { _all: true } }),
    prisma.fightPick.groupBy({ by: ["userId"], where: { ...scored, correct: true }, _count: { _all: true } }),
  ]);
  const hitBy = new Map(hits.map((h) => [h.userId, h._count._all]));

  await Promise.all(
    totals
      // One graded bout is not a card. That person already got the result
      // itself; repeating it as a "summary" is the same news twice.
      .filter((t) => t._count._all >= 2)
      .map((t) => {
        const got = hitBy.get(t.userId) ?? 0;
        const perfect = got === t._count._all;
        return notify(prisma, t.userId, {
          type: "PICK_RESULT",
          title: `${got} of ${t._count._all} on ${event.name}`,
          body: perfect
            ? "A perfect card. Every single call landed."
            : got === 0
              ? "Rough night. New card, clean slate."
              : `${event.name} is in the books — see how the room did.`,
          url: `/events/${event.slug}`,
          icon: perfect ? "🏆" : "📊",
          dedupeKey: `card_summary:${eventId}`,
          tag: `picks:${eventId}`,
        });
      }),
  );
}

/** Grade every decided bout that still has ungraded picks. Cron entrypoint. */
export async function resolveDuePicks(limit = 200): Promise<{ fights: number; picks: number }> {
  const due = await prisma.fight.findMany({
    where: { result: { not: "SCHEDULED" }, picksResolvedAt: null, picks: { some: {} } },
    select: { id: true },
    orderBy: { date: "asc" },
    take: limit,
  });
  let picks = 0;
  for (const f of due) picks += (await resolveFightPicks(f.id)).resolved;
  return { fights: due.length, picks };
}
