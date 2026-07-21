import "server-only";
import type { Prisma } from "@prisma/client";
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

  const matched = await prisma.$transaction(async (tx) => {
    const mine = await tx.battle.findFirst({
      where: { fightId, state: { in: ["WAITING", "ACTIVE"] }, OR: [{ challengerId: userId }, { opponentId: userId }] },
      select: { id: true },
    });
    if (mine) return null; // already battling here

    const open = await tx.battle.findFirst({
      where: { fightId, state: "WAITING", opponentId: null, challengerCorner: opposite(corner), challengerId: { not: userId } },
      orderBy: { createdAt: "asc" },
      select: { id: true, challengerId: true },
    });
    if (open) {
      const joined = await tx.battle.updateMany({
        where: { id: open.id, state: "WAITING", opponentId: null }, // guard against a concurrent join
        data: { opponentId: userId, opponentCorner: corner, opponentMethod: pick.method, opponentConfidence: pick.confidence, state: "ACTIVE", matchedAt: new Date() },
      });
      if (joined.count > 0) return { battleId: open.id, a: open.challengerId, b: userId };
    }
    await tx.battle.create({
      data: { fightId, challengerId: userId, challengerCorner: corner, challengerMethod: pick.method, challengerConfidence: pick.confidence },
    });
    return null;
  });

  if (matched) await announceMatch(fightId, matched.a, matched.b);
}

// ── "Opponent joined" — the moment the room goes live ────────────────────────
/** Tell both sides a battle just matched. Best-effort: a notification failure
 *  must never undo a pairing that already committed. */
async function announceMatch(fightId: string, aId: string, bId: string): Promise<void> {
  try {
    const f = await prisma.fight.findUnique({
      where: { id: fightId },
      select: { slug: true, red: { select: { name: true } }, blue: { select: { name: true } }, event: { select: { slug: true } } },
    });
    const url = f?.event ? `/events/${f.event.slug}#fight-${f.slug}` : "/";
    const bout = f ? `${f.red.name} vs ${f.blue.name}` : "this bout";
    const users = await prisma.user.findMany({ where: { id: { in: [aId, bId] } }, select: { id: true, name: true, username: true } });
    const nameOf = (id: string) => {
      const u = users.find((x) => x.id === id);
      return u?.name ?? u?.username ?? "Someone";
    };
    for (const [me, them] of [[aId, bId], [bId, aId]] as const) {
      await notify(prisma, me, {
        type: "BATTLE_MATCHED",
        title: `${nameOf(them)} took the other side`,
        body: `${bout} settles it. Your battle room is open.`,
        url, icon: "⚔️",
      });
    }
  } catch { /* non-fatal */ }
}

// ── Spectator → challenger ───────────────────────────────────────────────────
/**
 * Convert a community-room spectator into a battle. Both sides must already have
 * OPPOSITE picks on the bout — the prediction is what creates the right to argue,
 * so there is no "challenge" without a call on the line. Joins the target's open
 * battle (or the challenger's) where one exists rather than opening a duplicate.
 */
export async function challengeUser(
  challengerId: string,
  fightId: string,
  targetId: string,
): Promise<{ battleId: string } | { error: string }> {
  if (challengerId === targetId) return { error: "You can't battle yourself." };
  const [mine, theirs] = await Promise.all([
    prisma.fightPick.findUnique({ where: { userId_fightId: { userId: challengerId, fightId } }, select: { corner: true, method: true, confidence: true } }),
    prisma.fightPick.findUnique({ where: { userId_fightId: { userId: targetId, fightId } }, select: { corner: true, method: true, confidence: true } }),
  ]);
  if (!mine || !isCorner(mine.corner)) return { error: "Make your pick first — that's what you'd be defending." };
  if (!theirs || !isCorner(theirs.corner)) return { error: "They haven't picked this bout yet." };
  if (mine.corner === theirs.corner) return { error: "You both picked the same corner — nothing to settle." };

  type ChallengeResult = { battleId: string; matched: boolean } | { error: string };
  const result = await prisma.$transaction(async (tx): Promise<ChallengeResult> => {
    // Already paired with each other? Reuse it.
    const existing = await tx.battle.findFirst({
      where: {
        fightId, state: { in: ["WAITING", "ACTIVE"] },
        OR: [
          { challengerId, opponentId: targetId },
          { challengerId: targetId, opponentId: challengerId },
        ],
      },
      select: { id: true },
    });
    if (existing) return { battleId: existing.id, matched: false };

    // Either side already locked into someone else on this bout? One open battle
    // per user per fight keeps a rivalry meaningful.
    const blocking = await tx.battle.findFirst({
      where: {
        fightId, state: "ACTIVE",
        OR: [
          { challengerId }, { opponentId: challengerId },
          { challengerId: targetId }, { opponentId: targetId },
        ],
      },
      select: { challengerId: true, opponentId: true },
    });
    if (blocking) {
      const mineBlocked = blocking.challengerId === challengerId || blocking.opponentId === challengerId;
      return { error: mineBlocked ? "You're already in a battle on this bout." : "They're already battling someone here." };
    }

    // Join their waiting battle if they have one; else open one and pull them in.
    const waiting = await tx.battle.findFirst({
      where: { fightId, state: "WAITING", opponentId: null, challengerId: targetId },
      select: { id: true },
    });
    if (waiting) {
      const joined = await tx.battle.updateMany({
        where: { id: waiting.id, state: "WAITING", opponentId: null },
        data: { opponentId: challengerId, opponentCorner: mine.corner, opponentMethod: mine.method, opponentConfidence: mine.confidence, state: "ACTIVE", matchedAt: new Date() },
      });
      if (joined.count > 0) return { battleId: waiting.id, matched: true };
    }
    // Retire my own dangling WAITING battle so I don't hold two slots.
    await tx.battle.updateMany({
      where: { fightId, challengerId, state: "WAITING", opponentId: null },
      data: { state: "CANCELLED", resolvedAt: new Date() },
    });
    const created = await tx.battle.create({
      data: {
        fightId,
        challengerId, challengerCorner: mine.corner, challengerMethod: mine.method, challengerConfidence: mine.confidence,
        opponentId: targetId, opponentCorner: theirs.corner, opponentMethod: theirs.method, opponentConfidence: theirs.confidence,
        state: "ACTIVE", matchedAt: new Date(),
      },
      select: { id: true },
    });
    return { battleId: created.id, matched: true };
  });

  if ("error" in result) return { error: result.error };
  if (result.matched) await announceMatch(fightId, challengerId, targetId);
  return { battleId: result.battleId };
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
  // Deep-link straight into the bout's arena — the battle lives on the fight,
  // not on a page-wide discussion anchor.
  const boutUrl = f?.event ? `/events/${f.event.slug}#fight-${f.slug}` : `/predictions/${f?.slug ?? ""}`;

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

