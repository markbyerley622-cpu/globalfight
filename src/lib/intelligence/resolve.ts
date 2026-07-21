import "server-only";
import { prisma } from "@/lib/db";
import { awardReputation, pickReputation } from "@/lib/reputation";
import { notify } from "@/lib/notifications-store";
import { recordActivity } from "@/lib/activity";
import { awardCard, rarityForFight } from "@/lib/collectibles";

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
    // Nothing to grade — still stamp so the due-query stops selecting it.
    if (!fight.picksResolvedAt) await prisma.fight.update({ where: { id: fightId }, data: { picksResolvedAt: new Date() } });
    return { resolved: 0 };
  }

  const corner = winnerCorner(fight);
  const decisive = corner !== null; // draw / no-contest ⇒ picks voided, no payout
  const winnerFighterId = corner === "RED" ? fight.redId : corner === "BLUE" ? fight.blueId : null;
  const winnerName = corner === "RED" ? fight.red.name : corner === "BLUE" ? fight.blue.name : null;
  // Deep-link the reward straight to the fused event page (predictions section),
  // falling back to the bout redirect for the rare orphan fight with no event.
  const boutUrl = fight.event ? `/events/${fight.event.slug}#predictions` : `/predictions/${fight.slug}`;
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
        });
      } else {
        await notify(tx, pick.userId, {
          type: "PICK_RESULT",
          title: `Tough one — ${winnerName ?? "the other corner"} took it`,
          body: `Your pick didn't land — streak reset.`,
          url: boutUrl,
          icon: "❌",
        });
      }
    });

    resolved += 1;
  }

  await prisma.fight.update({ where: { id: fightId }, data: { picksResolvedAt: new Date() } });
  return { resolved };
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
