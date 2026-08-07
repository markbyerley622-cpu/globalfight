import "server-only";
import { activityChallenge } from "@/lib/activity/emit";
import type { Prisma, FightMethod } from "@prisma/client";
import { prisma } from "@/lib/db";
import { awardReputation, battleReputation, BATTLE } from "@/lib/reputation";
import { notify } from "@/lib/notifications-store";
import { recordActivity } from "@/lib/activity";
import { publicDisplayName } from "@/lib/display-name";
import { deliverChallengeToDm } from "@/lib/messages/challenge-card";

/** Same exposure as the settlement fan-out: several writes plus notifications per
 *  battle, against a database that may be a continent away. Prisma's 5s default
 *  aborts the lot and rolls back a resolved battle. See intelligence/resolve.ts. */
const BATTLE_TX = {
  timeout: Number(process.env.SETTLEMENT_TX_TIMEOUT_MS ?? 30_000),
  maxWait: Number(process.env.SETTLEMENT_TX_MAX_WAIT_MS ?? 15_000),
} as const;

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

  // ── An invite addressed to me is answered FIRST ─────────────────────────
  //
  // This has to run before the "am I already in a battle here?" guard below,
  // because a pending invite IS a battle row with `opponentId = me` — the guard
  // would see it, conclude I am already battling, and return. The invite would
  // then sit unanswered forever no matter how many times I picked, which is the
  // failure this ordering exists to prevent.
  const accepted = await acceptPendingInvite(userId, fightId, corner, pick);
  if (accepted) {
    await announceMatch(fightId, accepted.challengerId, userId);
    return;
  }

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

// ── Invites ──────────────────────────────────────────────────────────────────
/**
 * A PENDING INVITE is `state: WAITING` + `opponentId` set + `opponentCorner`
 * null.
 *
 * ── Why that shape, and not a new BattleState ─────────────────────────────
 * The three columns already say it exactly: somebody is named as the opponent
 * (`opponentId`), they have not taken a side yet (`opponentCorner` is null),
 * and the battle is not live (`WAITING`). An `INVITED` enum member would be a
 * fourth way to say the same thing that every existing query would then have to
 * be audited against.
 *
 * The pre-existing queries are already safe with it, which is what makes this
 * shape usable rather than merely tidy — each one either filters
 * `opponentId: null` (so an invite is excluded) or filters `state: "ACTIVE"`
 * (so an invite is excluded). Both were checked before this was written; a new
 * query on Battle must keep that property.
 */
const PENDING_INVITE = { state: "WAITING", opponentCorner: null } as const;

/**
 * Answer an invite addressed to me, if the corner I just picked opposes it.
 *
 * Returns the challenger when the battle went live, else null. A same-corner
 * pick deliberately leaves the invite PENDING rather than cancelling it: the
 * inviter's question is still open and the invitee may switch corners before
 * the bell. It expires with the bout like any other unmatched battle.
 */
async function acceptPendingInvite(
  userId: string,
  fightId: string,
  corner: Corner,
  pick: { method: FightMethod | null; confidence: number | null },
): Promise<{ challengerId: string } | null> {
  const invite = await prisma.battle.findFirst({
    where: {
      ...PENDING_INVITE,
      fightId,
      opponentId: userId,
      // Only an invite I can actually settle: their corner must be the other one.
      challengerCorner: opposite(corner),
    },
    orderBy: { createdAt: "asc" },
    select: { id: true, challengerId: true },
  });
  if (!invite) return null;

  // Guarded updateMany, not update: two devices picking at once would otherwise
  // both "accept" and the second would overwrite an already-live battle's
  // matchedAt. The guard makes the loser a no-op.
  const { count } = await prisma.battle.updateMany({
    where: { id: invite.id, ...PENDING_INVITE },
    data: {
      opponentCorner: corner,
      opponentMethod: pick.method,
      opponentConfidence: pick.confidence,
      state: "ACTIVE",
      matchedAt: new Date(),
    },
  });
  return count > 0 ? { challengerId: invite.challengerId } : null;
}

/**
 * Open a PENDING invite from the challenger to somebody who has not picked.
 *
 * Concurrency-safe per CLAUDE.md rule 4: the duplicate/blocking checks and the
 * create run in ONE transaction, and the challenger's own stale invite is
 * retired by a guarded `updateMany` rather than a read-then-delete.
 */
async function inviteUser(
  challengerId: string,
  fightId: string,
  targetId: string,
  mine: { corner: string; method: FightMethod | null; confidence: number | null },
): Promise<{ battleId: string } | { error: string }> {
  const corner = mine.corner;
  return prisma.$transaction(async (tx) => {
    // Already called this person out on this bout? Reuse it — a second tap on
    // the same name must not open a second row or re-buzz their phone.
    const existing = await tx.battle.findFirst({
      where: { ...PENDING_INVITE, fightId, challengerId, opponentId: targetId },
      select: { id: true },
    });
    if (existing) return { battleId: existing.id };

    // An ACTIVE battle on either side wins over a new invite. Checked with the
    // same wording as the matched path so the two cannot drift apart.
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

    // One outstanding call-out per challenger per bout. Retiring the previous
    // one keeps "your challenge" a single, answerable thing instead of letting
    // one person hold invites open against half their following.
    await tx.battle.updateMany({
      where: { ...PENDING_INVITE, fightId, challengerId },
      data: { state: "CANCELLED", resolvedAt: new Date() },
    });
    // ...and the open UNADDRESSED battle from the ordinary matchmaker, for the
    // same reason pairBattle retires it: two slots held by one person.
    await tx.battle.updateMany({
      where: { fightId, challengerId, state: "WAITING", opponentId: null },
      data: { state: "CANCELLED", resolvedAt: new Date() },
    });

    const created = await tx.battle.create({
      data: {
        fightId,
        challengerId,
        challengerCorner: corner,
        challengerMethod: mine.method,
        challengerConfidence: mine.confidence,
        // Named, but with NO corner: that null is what marks this a pending
        // invite rather than a live battle. See PENDING_INVITE.
        opponentId: targetId,
        state: "WAITING",
      },
      select: { id: true },
    });
    return { battleId: created.id };
  }, BATTLE_TX);
}

/** Tell somebody they have been called out. Best-effort, like announceMatch. */
async function announceInvite(
  fightId: string,
  challengerId: string,
  targetId: string,
  /**
   * The thread the challenge card was delivered into.
   *
   * When present the notification opens THAT conversation, where the card and
   * its Accept controls are. Falling back to the fight page is a real fallback,
   * not a shrug: if the card could not be delivered, the fight page is the only
   * place the recipient can still act.
   */
  conversationId: string | null,
): Promise<void> {
  try {
    const [f, challenger] = await Promise.all([
      prisma.fight.findUnique({
        where: { id: fightId },
        select: {
          slug: true,
          red: { select: { name: true } },
          blue: { select: { name: true } },
          event: { select: { slug: true } },
        },
      }),
      prisma.user.findUnique({ where: { id: challengerId }, select: { name: true, username: true } }),
    ]);
    const bout = f ? `${f.red.name} vs ${f.blue.name}` : "this bout";
    const who = challenger ? publicDisplayName(challenger) : "Someone";
    await notify(prisma, targetId, {
      type: "BATTLE_INVITE",
      title: `${who} challenged you`,
      // The body has to state the PRICE, because the invite is not yet a
      // battle: nothing happens until the recipient takes the other corner.
      body: `${bout} — make your call on the other corner to accept.`,
      // Deep link, never a generic inbox: the notification lands the recipient
      // exactly where the thing it is about lives.
      url: conversationId
        ? `/messages/${conversationId}`
        : f?.event ? `/events/${f.event.slug}#fight-${f.slug}` : "/",
      icon: "fight",
      // One pending call-out per person per bout. Without this, an inviter who
      // cancels and re-sends buzzes the same phone again for the same question.
      dedupeKey: `battle_invite:${fightId}:${challengerId}`,
    });
  } catch { /* non-fatal */ }
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
      return u ? publicDisplayName(u) : "Someone";
    };
    for (const [me, them] of [[aId, bId], [bId, aId]] as const) {
      await notify(prisma, me, {
        type: "BATTLE_MATCHED",
        title: `${nameOf(them)} took the other side`,
        body: `${bout} settles it. Your battle room is open.`,
        url, icon: "fight",
      });
    }
  } catch { /* non-fatal */ }
}

// ── Spectator → challenger ───────────────────────────────────────────────────
/**
 * Challenge a specific person on a bout.
 *
 * The CHALLENGER must have a call on the line — that is what they are
 * defending, and it is the price of entry. The TARGET need not: if they have
 * not picked, this opens a pending invite and notifies them, and their pick on
 * the other corner is what accepts it (see acceptPendingInvite, driven from
 * pairBattle). If they HAVE picked the opposite corner the battle goes live
 * immediately, joining an existing open battle rather than duplicating one.
 *
 * The only remaining refusal on the target's side is a SAME-corner pick, which
 * is not a matchmaking gap — the two of them agree, so there is nothing to
 * settle.
 */
export async function challengeUser(
  challengerId: string,
  fightId: string,
  targetId: string,
): Promise<{ battleId: string; pending?: boolean; conversationId?: string } | { error: string }> {
  if (challengerId === targetId) return { error: "You can't battle yourself." };
  const [mine, theirs] = await Promise.all([
    prisma.fightPick.findUnique({ where: { userId_fightId: { userId: challengerId, fightId } }, select: { corner: true, method: true, confidence: true } }),
    prisma.fightPick.findUnique({ where: { userId_fightId: { userId: targetId, fightId } }, select: { corner: true, method: true, confidence: true } }),
  ]);
  if (!mine || !isCorner(mine.corner)) return { error: "Make your pick first — that's what you'd be defending." };

  // ── The friend has not picked yet: INVITE them ──────────────────────────
  //
  // This used to be a refusal ("They haven't picked this bout yet"), and that
  // was the flow backwards. The person you want to challenge is the friend
  // texting you about this fight, and they have almost never opened the app
  // yet — requiring their pick first meant the feature only worked for people
  // who did not need it. The call-out is the invitation: it lands in their
  // notifications and their answer IS their pick.
  if (!theirs || !isCorner(theirs.corner)) {
    const invited = await inviteUser(challengerId, fightId, targetId, mine);
    if ("error" in invited) return invited;
    // The card goes into a CONVERSATION first, so the notification below has a
    // real destination to point at rather than a generic inbox.
    const delivered = await deliverChallengeToDm(challengerId, targetId, invited.battleId, fightId);
    await announceInvite(fightId, challengerId, targetId, delivered?.conversationId ?? null);
    // `pending` is what lets the UI tell the truth. An invite is NOT a rival
    // yet, and reporting "they're your rival, settle it in the room" for a
    // call-out nobody has answered would send the user to an empty room.
    //
    // `conversationId` closes the loop from the CHALLENGER's side: they get the
    // same destination the recipient's notification points at, so both people
    // end up in the one place the challenge actually lives.
    return { ...invited, pending: true, conversationId: delivered?.conversationId };
  }

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

  // ACTIVITY for BOTH sides — one sent it, the other took it on. Neither type
  // had a producer before, so challenges were invisible outside the room.
  try {
    const [me, them, fight] = await Promise.all([
      prisma.user.findUnique({ where: { id: challengerId }, select: { name: true, username: true } }),
      prisma.user.findUnique({ where: { id: targetId }, select: { name: true, username: true } }),
      prisma.fight.findUnique({ where: { id: fightId }, select: { slug: true } }),
    ]);
    if (fight && me && them) {
      await activityChallenge(prisma, challengerId, {
        accepted: false,
        opponentName: publicDisplayName(them),
        opponentUsername: them.username,
        fightSlug: fight.slug,
      });
      await activityChallenge(prisma, targetId, {
        accepted: true,
        opponentName: publicDisplayName(me),
        opponentUsername: me.username,
        fightSlug: fight.slug,
      });
    }
  } catch { /* non-fatal */ }

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
          await notify(tx, uid, { type: "BATTLE_RESULT", title: "Battle drawn", body: "Neither call landed — no result this time.", url: boutUrl, icon: "community" });
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
      await notify(tx, winnerId, { type: "BATTLE_RESULT", title: "You won the battle", body: `+${bonus} reputation · beat ${loser?.name ?? "your rival"}`, url: boutUrl, icon: "victory" });

      await awardReputation(tx, loserId, -BATTLE.LOSS, "battle_loss", { type: "battle", id: b.id });
      await tx.user.update({ where: { id: loserId }, data: { battleLosses: { increment: 1 }, battleStreak: 0 } });
      await notify(tx, loserId, { type: "BATTLE_RESULT", title: "You lost the battle", body: `${winner?.name ?? "Your rival"} called it. Rematch next card.`, url: boutUrl, icon: "missed" });

      resolved += 1;
    }, BATTLE_TX);
  }
  return { resolved };
}

