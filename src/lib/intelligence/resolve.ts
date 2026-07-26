import "server-only";
import { prisma } from "@/lib/db";
import { awardReputation, pickReputation } from "@/lib/reputation";
import { notify } from "@/lib/notifications-store";
import { recordActivity } from "@/lib/activity";
import { awardCard, rarityForFight } from "@/lib/collectibles";
import { resolveFightBattles } from "@/lib/battles";
import { winnerCorner, upsetFactor } from "@/lib/intelligence/scoring";
import { invalidate } from "@/lib/cache";
import { log } from "@/lib/scraper/logger";
import { notifyFightResult } from "@/lib/social/triggers";

/**
 * Interactive-transaction limits for the settlement fan-out.
 *
 * Prisma defaults to a 5-second timeout — generous in-region, and nowhere near enough
 * from a laptop against a remote database. Grading ONE pick does a claim, a user
 * update, a reputation ledger write, a collectible award, two activity rows and a
 * notification: seven round-trips, and at ~300ms each that is over budget before the
 * notification is even attempted.
 *
 * A repair run showed exactly that — "Transaction not found. Transaction ID is
 * invalid, refers to an old closed transaction" thrown from notify(), the whole payout
 * rolled back, settlement:FAILED. The result still landed (settlement never blocks the
 * write) and the reconciler would have retried into the same timeout, forever.
 *
 * Nothing here is made faster; the work is given honest room. It stays ONE transaction
 * because a half-applied payout — reputation without the graded pick — is the outcome
 * this engine exists to prevent.
 */
const SETTLEMENT_TX = {
  timeout: Number(process.env.SETTLEMENT_TX_TIMEOUT_MS ?? 30_000),
  maxWait: Number(process.env.SETTLEMENT_TX_MAX_WAIT_MS ?? 15_000),
} as const;

// ════════════════════════════════════════════════════════════════════════════
//  Combat Intelligence Engine — the resolution pipeline.
//
//  When a bout is decided this grades every pick and fans the consequences into
//  the shared systems, deterministically and idempotently:
//
//    grade pick → update stats/streak → award reputation → earn collectible
//                → notify → record activity
//
//  IDEMPOTENCY — and, now, CONCURRENCY SAFETY.
//
//  Each pick's fan-out is wrapped in its own transaction: one user's payout can't
//  half-apply, and one failure doesn't poison the rest of the card. The fight is
//  stamped `picksResolvedAt` when done, so re-runs skip it.
//
//  But "grade only while correct IS NULL" was a READ-then-WRITE: the picks were
//  selected in loadFight and updated later. With a single hourly cron that was
//  safe by luck. Settlement is now also triggered the moment a result is WRITTEN
//  (see onResultWritten), so two runs can overlap — and awardReputation appends a
//  ledger row and increments unconditionally, so an overlap would DOUBLE-AWARD.
//
//  The fix is an atomic CLAIM: `updateMany({ where: { correct: null } })` and act
//  only when it reports 1 row. Postgres serialises that, so exactly one runner
//  ever owns a given pick's payout, however many are in flight.
// ════════════════════════════════════════════════════════════════════════════

function loadFight(fightId: string) {
  return prisma.fight.findUnique({
    where: { id: fightId },
    include: {
      red: { select: { id: true, slug: true, name: true } },
      blue: { select: { id: true, slug: true, name: true } },
      event: { select: { slug: true } },
      // username: lets a correct-pick notification deep-link to the shareable
      // Victory Card (/u/<user>/call/<fight>) instead of the bare bout page.
      picks: { where: { correct: null }, include: { user: { select: { username: true } } } },
    },
  });
}

export async function resolveFightPicks(fightId: string): Promise<{ resolved: number }> {
  const fight = await loadFight(fightId);
  if (!fight || fight.result === "SCHEDULED") return { resolved: 0 };
  if (fight.picks.length === 0) {
    // Nothing to grade — resolve any battles (a re-run may still have open ones),
    // then stamp so the due-query stops selecting it.
    await resolveFightBattles(fightId, winnerCorner(fight));
    await stampResolved(fightId);
    await invalidateSettlement(fight);
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
  const upset = upsetFactor(onWinner, fight.picks.length, decisive);

  // A void bout (draw / no-contest) has no winner to have called. Previously every
  // pick on one was stored as `correct = false`, which made it render as a MISS
  // while `picksResolved` was deliberately NOT incremented — so the profile said
  // 0/0 while the list showed a red X, and getJustHappened counted the pick as
  // graded when the user's record didn't. Void picks now stay `correct = null` and
  // are recognised by the fight's own result (pickStatus → VOID). The fight's
  // `picksResolvedAt` stamp is what stops reprocessing, not a false grade.
  if (!decisive) {
    await resolveFightBattles(fightId, corner);
    await stampResolved(fightId);
    await invalidateSettlement(fight);
    return { resolved: 0 };
  }

  let resolved = 0;
  for (const pick of fight.picks) {
    const correct = pick.corner === corner;

    // The transaction REPORTS whether it claimed, because `resolved` is what the
    // cron and onResultWritten log. Incrementing it unconditionally made every
    // concurrent runner claim credit for the same payout — five racing runs on a
    // three-pick bout reported fifteen settlements. The payouts were still
    // exactly-once (the claim below guarantees that); the TELEMETRY lied, which on
    // a metric whose whole job is to prove this pipeline converged is its own bug.
    const claimed = await prisma.$transaction(async (tx) => {
      // ATOMIC CLAIM. Only the runner whose updateMany actually flips this row
      // from NULL owns the payout below; a concurrent runner blocks on the row,
      // re-evaluates `correct IS NULL` after the first commits, and gets count 0 —
      // so reputation, cards and notifications happen exactly once.
      const claim = await tx.fightPick.updateMany({
        where: { userId: pick.userId, fightId, correct: null },
        data: { correct },
      });
      if (claim.count !== 1) return false;

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
        const rep = pickReputation({ upsetFactor: upset, confidence: pick.confidence, streak: user.pickStreak });
        await awardReputation(tx, pick.userId, rep, "pick_correct", { type: "fight", id: fightId });

        if (winnerFighterId) {
          await awardCard(tx, pick.userId, winnerFighterId, { rarity, reason: "correct_pick", fightId });
          await recordActivity(tx, pick.userId, { type: "CARD_EARNED", title: `Earned a ${rarity.toLowerCase()} ${winnerName} card`, url: boutUrl });
        }
        // A correct call now has a shareable Victory Card — send the win straight
        // to it (the peak moment to share). Falls back to the bout for the rare
        // user with no username (nothing to build a /u/ URL from).
        const cardUrl = pick.user.username
          ? `/u/${pick.user.username}/call/${fight.slug}`
          : boutUrl;
        await recordActivity(tx, pick.userId, { type: "PICK_CORRECT", title: `Correctly picked ${winnerName}`, url: cardUrl });
        await notify(tx, pick.userId, {
          type: "PICK_RESULT",
          title: `You called it — ${winnerName} won`,
          body: `+${rep} reputation · ${user.pickStreak}-pick streak${winnerFighterId ? ` · ${rarity.toLowerCase()} card earned` : ""}`,
          url: cardUrl,
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
      return true;
    }, SETTLEMENT_TX);

    if (claimed) resolved += 1;
  }

  // The fight is the referee: resolve every open battle on this bout now that each
  // side's pick is graded (winner = whoever's FightPick landed). Idempotent.
  await resolveFightBattles(fightId, corner);

  await stampResolved(fightId);

  // Settlement changed derived aggregates every surface reads — the card's crowd
  // split, the room's verdict, the event payload. Nothing invalidated them, so a
  // cached page could keep serving the pre-settlement view after the payouts had
  // already landed. The write is the trigger; the cache must follow it.
  await invalidateSettlement(fight);

  // FOLLOWERS. Distinct from the pick payouts above: those go to people who CALLED
  // this bout, this goes to everyone who follows either fighter, the event or the
  // promotion — whether or not they predicted. One shared dedupeKey means a reader
  // following all four is told once, not four times. Never throws.
  await notifyFightResult(fightId);

  // If that was the last graded bout on the card, close the loop with one
  // scoreline. Best-effort: the payouts above are the real work.
  if (fight.eventId) await notifyCardSummary(fight.eventId).catch(() => {});

  return { resolved };
}

/** Stamp the fight as settled. Conditional, so concurrent runners don't fight over it. */
async function stampResolved(fightId: string): Promise<void> {
  await prisma.fight.updateMany({
    where: { id: fightId, picksResolvedAt: null },
    data: { picksResolvedAt: new Date() },
  });
}

/** Drop every cached read whose content depends on settlement having happened. */
async function invalidateSettlement(fight: { event: { slug: string } | null }): Promise<void> {
  await Promise.all([
    fight.event ? invalidate(`event:${fight.event.slug}`) : Promise.resolve(),
    invalidate("events:results"),
    invalidate("events:upcoming"),
  ]).catch(() => {
    /* a cache miss is a slow page, never a wrong payout — never fail settlement */
  });
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

/**
 * Grade every decided bout that still has ungraded picks — the RECONCILER.
 *
 * This is the safety net, not the primary path: settlement now fires from the
 * result write itself (onResultWritten). This exists so a missed hook, a crashed
 * process or a result written directly in the database still converges.
 *
 * The old query required `picks: { some: {} }`, which left a blind spot: a decided
 * bout carrying an OPEN BATTLE but no FightPick rows was never selected, so that
 * battle stayed unresolved forever. Both gaps are covered now.
 */
export async function resolveDuePicks(limit = 200): Promise<{ fights: number; picks: number }> {
  const due = await prisma.fight.findMany({
    where: {
      result: { not: "SCHEDULED" },
      picksResolvedAt: null,
      OR: [
        { picks: { some: {} } },
        // A bout whose battles are still open is unsettled even with no picks.
        { battles: { some: { state: { in: ["WAITING", "ACTIVE"] } } } },
      ],
    },
    select: { id: true },
    orderBy: { date: "asc" },
    take: limit,
  });
  let picks = 0;
  for (const f of due) picks += (await resolveFightPicks(f.id)).resolved;
  return { fights: due.length, picks };
}

// ════════════════════════════════════════════════════════════════════════════
//  THE DOMAIN EVENT — "an official result was written".
//
//  This is the link that did not exist. `resolveFightPicks` had exactly ONE
//  caller: the resolve-picks cron. So a result arriving from ingest, or typed into
//  the admin editor, updated Fight.result and the event page and then STOPPED. The
//  prediction stayed open, the challenge stayed unsettled and the accuracy stayed
//  0/0 until the next cron tick — and on Vercel, where resolve-picks was never
//  registered as a cron at all, until never.
//
//  Every site that persists a result now calls this, so the invariant holds by
//  construction rather than by schedule:
//
//      result written  →  settlement  →  stats · rep · battles · notifications
//                                        →  caches invalidated
//
//  It NEVER throws. A settlement failure must not roll back or reject the result
//  write — the result is the fact, settlement is a consequence, and the reconciler
//  above will retry. It logs loudly instead, because a silent failure here is
//  exactly the class of bug this whole change exists to remove.
// ════════════════════════════════════════════════════════════════════════════

export async function onResultWritten(
  fightId: string,
  source: string,
): Promise<{ settled: boolean; resolved: number }> {
  try {
    const out = await resolveFightPicks(fightId);
    log.info({ op: "settle.onResultWritten", fightId, source, resolved: out.resolved }, "settlement:fired");
    return { settled: true, resolved: out.resolved };
  } catch (e) {
    log.error(
      { op: "settle.onResultWritten", fightId, source, err: (e as Error).message },
      "settlement:FAILED — result stands, reconciler will retry",
    );
    return { settled: false, resolved: 0 };
  }
}

/**
 * Fire settlement for many fights at once — the ingest path, which writes a whole
 * card in one pass. Sequential on purpose: each settlement runs its own
 * transactions and there is no gain in hammering the pool during a cron.
 */
export async function onResultsWritten(fightIds: string[], source: string): Promise<number> {
  let resolved = 0;
  for (const id of fightIds) resolved += (await onResultWritten(id, source)).resolved;
  return resolved;
}
