import "server-only";
import type { Prisma, FightMethod } from "@prisma/client";
import { prisma } from "@/lib/db";
import { awardReputation, battleReputation, BATTLE } from "@/lib/reputation";
import { notify } from "@/lib/notifications-store";
import { recordActivity } from "@/lib/activity";

// ════════════════════════════════════════════════════════════════════════════
//  Prediction Battles — the domain service.
//
//  Two users who picked OPPOSITE corners on a bout are paired into a Battle. The
//  fight is the referee: at resolution the winner is the side whose graded
//  FightPick landed (read FRESH, so editing a pick after matching is respected).
//  Rewards LAYER onto the single reputation score; head-to-head persists on Rivalry.
//  Idempotent + transactional throughout — running resolve twice never double-pays.
// ════════════════════════════════════════════════════════════════════════════

type Db = Prisma.TransactionClient;
type Corner = "RED" | "BLUE";
const opposite = (c: Corner): Corner => (c === "RED" ? "BLUE" : "RED");
const isCorner = (v: string): v is Corner => v === "RED" || v === "BLUE";

// ── Matchmaking ───────────────────────────────────────────────────────────────
/**
 * Pair a user into a battle on a bout from their current pick. Idempotent: at most
 * one OPEN (WAITING/ACTIVE) battle per user per fight. Joins a waiting opposite-
 * corner opponent if one exists (race-safe via a guarded updateMany), else opens a
 * WAITING battle. Non-blocking to call — safe to fire from the pick path.
 */
export async function pairBattle(userId: string, fightId: string): Promise<void> {
  const pick = await prisma.fightPick.findUnique({
    where: { userId_fightId: { userId, fightId } },
    select: { corner: true, method: true, confidence: true },
  });
  if (!pick || !isCorner(pick.corner)) return;
  const corner = pick.corner;

  await prisma.$transaction(async (tx) => {
    const mine = await tx.battle.findFirst({
      where: { fightId, state: { in: ["WAITING", "ACTIVE"] }, OR: [{ challengerId: userId }, { opponentId: userId }] },
      select: { id: true },
    });
    if (mine) return; // already battling here

    const open = await tx.battle.findFirst({
      where: { fightId, state: "WAITING", opponentId: null, challengerCorner: opposite(corner), challengerId: { not: userId } },
      orderBy: { createdAt: "asc" },
      select: { id: true },
    });
    if (open) {
      const joined = await tx.battle.updateMany({
        where: { id: open.id, state: "WAITING", opponentId: null }, // guard against a concurrent join
        data: { opponentId: userId, opponentCorner: corner, opponentMethod: pick.method, opponentConfidence: pick.confidence, state: "ACTIVE", matchedAt: new Date() },
      });
      if (joined.count > 0) return;
    }
    await tx.battle.create({
      data: { fightId, challengerId: userId, challengerCorner: corner, challengerMethod: pick.method, challengerConfidence: pick.confidence },
    });
  });
}

// ── Rivalry (persisted head-to-head, canonical pair userA<userB) ──────────────
async function bumpRivalry(tx: Db, aId: string, bId: string, winnerId: string | null): Promise<void> {
  const [x, y] = aId < bId ? [aId, bId] : [bId, aId];
  const now = new Date();
  const draw = winnerId === null;
  const row = await tx.rivalry.findUnique({ where: { userAId_userBId: { userAId: x, userBId: y } } });
  if (!row) {
    await tx.rivalry.create({
      data: {
        userAId: x, userBId: y,
        aWins: winnerId === x ? 1 : 0,
        bWins: winnerId === y ? 1 : 0,
        draws: draw ? 1 : 0,
        currentStreakUserId: draw ? null : winnerId,
        currentStreak: draw ? 0 : 1,
        bestStreakUserId: draw ? null : winnerId,
        bestStreak: draw ? 0 : 1,
        firstBattleAt: now, lastBattleAt: now,
      },
    });
    return;
  }
  const streak = draw ? 0 : row.currentStreakUserId === winnerId ? row.currentStreak + 1 : 1;
  const best = streak > row.bestStreak ? streak : row.bestStreak;
  await tx.rivalry.update({
    where: { userAId_userBId: { userAId: x, userBId: y } },
    data: {
      aWins: { increment: winnerId === x ? 1 : 0 },
      bWins: { increment: winnerId === y ? 1 : 0 },
      draws: { increment: draw ? 1 : 0 },
      currentStreak: streak,
      currentStreakUserId: draw ? null : winnerId,
      bestStreak: best,
      bestStreakUserId: best > row.bestStreak ? winnerId : row.bestStreakUserId,
      lastBattleAt: now,
    },
  });
}

// ── Resolution — the fight is the referee ─────────────────────────────────────
/**
 * Resolve every open battle on a decided bout. Called from the resolution engine
 * AFTER picks are graded, so FightPick.correct is set. Idempotent (per-battle state
 * guard) and transactional (one tx per battle — one payout can't half-apply).
 */
export async function resolveFightBattles(fightId: string, winnerCorner: Corner | null): Promise<{ resolved: number }> {
  const battles = await prisma.battle.findMany({
    where: { fightId, state: { in: ["WAITING", "ACTIVE"] } },
    select: { id: true },
  });
  if (!battles.length) return { resolved: 0 };

  // Underdog bonus: was the winning corner the crowd minority? One groupBy per fight.
  let winnerWasUnderdog = false;
  if (winnerCorner) {
    const rows = await prisma.fightPick.groupBy({ by: ["corner"], where: { fightId }, _count: { corner: true } });
    const total = rows.reduce((s, r) => s + r._count.corner, 0);
    const win = rows.find((r) => r.corner === winnerCorner)?._count.corner ?? 0;
    winnerWasUnderdog = total > 0 && win / total < 0.5;
  }

  const f = await prisma.fight.findUnique({ where: { id: fightId }, select: { slug: true, event: { select: { slug: true } } } });
  const boutUrl = f?.event ? `/events/${f.event.slug}#predictions` : `/predictions/${f?.slug ?? ""}`;

  let resolved = 0;
  for (const b of battles) {
    await prisma.$transaction(async (tx) => {
      const fresh = await tx.battle.findUnique({ where: { id: b.id }, select: { state: true, challengerId: true, opponentId: true } });
      if (!fresh || (fresh.state !== "WAITING" && fresh.state !== "ACTIVE")) return; // idempotent guard

      if (!fresh.opponentId) {
        await tx.battle.update({ where: { id: b.id }, data: { state: "EXPIRED", resolvedAt: new Date() } });
        return;
      }
      const challengerId = fresh.challengerId;
      const oppId = fresh.opponentId;

      const [cp, op] = await Promise.all([
        tx.fightPick.findUnique({ where: { userId_fightId: { userId: challengerId, fightId } }, select: { correct: true, confidence: true } }),
        tx.fightPick.findUnique({ where: { userId_fightId: { userId: oppId, fightId } }, select: { correct: true, confidence: true } }),
      ]);
      const cWon = cp?.correct === true;
      const oWon = op?.correct === true;
      let winnerId: string | null = null;
      let loserId: string | null = null;
      if (cWon && !oWon) { winnerId = challengerId; loserId = oppId; }
      else if (oWon && !cWon) { winnerId = oppId; loserId = challengerId; }

      await tx.battle.update({ where: { id: b.id }, data: { state: "RESOLVED", winnerId, loserId, resolvedSource: "fight_result", resolvedAt: new Date() } });
      await bumpRivalry(tx, challengerId, oppId, winnerId);

      if (!winnerId || !loserId) {
        await tx.user.update({ where: { id: challengerId }, data: { battleDraws: { increment: 1 } } });
        await tx.user.update({ where: { id: oppId }, data: { battleDraws: { increment: 1 } } });
        for (const uid of [challengerId, oppId]) {
          await notify(tx, uid, { type: "BATTLE_RESULT", title: "Battle drawn", body: "Neither call landed — no result this time.", url: boutUrl, icon: "🤝" });
        }
        resolved += 1;
        return;
      }

      const [loser, winner] = await Promise.all([
        tx.user.findUnique({ where: { id: loserId }, select: { name: true, picksResolved: true, picksCorrect: true } }),
        tx.user.findUnique({ where: { id: winnerId }, select: { name: true, battleStreak: true, bestBattleStreak: true } }),
      ]);
      const loserAccuracy = loser && loser.picksResolved > 0 ? (loser.picksCorrect / loser.picksResolved) * 100 : 50;
      const loserConfidence = (loserId === challengerId ? cp?.confidence : op?.confidence) ?? null;
      const bonus = battleReputation({ opponentAccuracy: loserAccuracy, winnerWasUnderdog, opponentConfidence: loserConfidence });

      const newStreak = (winner?.battleStreak ?? 0) + 1;
      await awardReputation(tx, winnerId, bonus, "battle_win", { type: "battle", id: b.id });
      await tx.user.update({
        where: { id: winnerId },
        data: { battleWins: { increment: 1 }, battleStreak: newStreak, bestBattleStreak: Math.max(newStreak, winner?.bestBattleStreak ?? 0) },
      });
      await recordActivity(tx, winnerId, { type: "BATTLE_WON", title: `Won a battle vs ${loser?.name ?? "a rival"}`, url: boutUrl });
      await notify(tx, winnerId, { type: "BATTLE_RESULT", title: "You won the battle", body: `+${bonus} reputation · beat ${loser?.name ?? "your rival"}`, url: boutUrl, icon: "🏆" });

      await awardReputation(tx, loserId, -BATTLE.LOSS, "battle_loss", { type: "battle", id: b.id });
      await tx.user.update({ where: { id: loserId }, data: { battleLosses: { increment: 1 }, battleStreak: 0 } });
      await notify(tx, loserId, { type: "BATTLE_RESULT", title: "You lost the battle", body: `${winner?.name ?? "Your rival"} called it. Rematch next card.`, url: boutUrl, icon: "❌" });

      resolved += 1;
    });
  }
  return { resolved };
}

// ── Read side (for the Battle card on the fight) ──────────────────────────────
export interface BattleOpponent {
  username: string | null;
  name: string | null;
  image: string | null;
  corner: string | null;
  method: FightMethod | null;
  confidence: number | null;
}
export interface FightBattle {
  state: "WAITING" | "ACTIVE";
  opponent: BattleOpponent | null; // null while still waiting for a match
  record: { you: number; them: number } | null; // viewer's head-to-head vs this opponent
}

/**
 * The viewer's OPEN battle on each of the given bouts, with the opponent + the
 * head-to-head record. One battle query + one rivalry query (no N+1). Degrades to
 * an empty map if the Battle tables aren't migrated yet, so the page never breaks.
 */
export async function getBattlesForFights(viewerId: string, fightIds: string[]): Promise<Map<string, FightBattle>> {
  const out = new Map<string, FightBattle>();
  if (!fightIds.length) return out;
  try {
    const [battles, rivalries] = await Promise.all([
      prisma.battle.findMany({
        where: { fightId: { in: fightIds }, state: { in: ["WAITING", "ACTIVE"] }, OR: [{ challengerId: viewerId }, { opponentId: viewerId }] },
        select: {
          fightId: true, state: true, challengerId: true, opponentId: true,
          challengerCorner: true, challengerMethod: true, challengerConfidence: true,
          opponentCorner: true, opponentMethod: true, opponentConfidence: true,
          challenger: { select: { username: true, name: true, image: true } },
          opponent: { select: { username: true, name: true, image: true } },
        },
      }),
      prisma.rivalry.findMany({ where: { OR: [{ userAId: viewerId }, { userBId: viewerId }] } }),
    ]);

    const recordByOther = new Map<string, { you: number; them: number }>();
    for (const r of rivalries) {
      const other = r.userAId === viewerId ? r.userBId : r.userAId;
      recordByOther.set(other, r.userAId === viewerId ? { you: r.aWins, them: r.bWins } : { you: r.bWins, them: r.aWins });
    }

    for (const b of battles) {
      const iAmChallenger = b.challengerId === viewerId;
      const oppUser = iAmChallenger ? b.opponent : b.challenger;
      const oppId = iAmChallenger ? b.opponentId : b.challengerId;
      out.set(b.fightId, {
        state: b.state as "WAITING" | "ACTIVE",
        opponent: oppUser
          ? {
              username: oppUser.username, name: oppUser.name, image: oppUser.image,
              corner: iAmChallenger ? b.opponentCorner : b.challengerCorner,
              method: iAmChallenger ? b.opponentMethod : b.challengerMethod,
              confidence: iAmChallenger ? b.opponentConfidence : b.challengerConfidence,
            }
          : null,
        record: oppId ? recordByOther.get(oppId) ?? null : null,
      });
    }
  } catch {
    /* Battle tables not migrated yet — no battle cards, page still renders. */
  }
  return out;
}
