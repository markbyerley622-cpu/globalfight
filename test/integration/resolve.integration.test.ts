import { test, before, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "@/lib/db";
import { resolveFightPicks, resolveDuePicks, onResultWritten } from "@/lib/intelligence/resolve";
import { resultOps } from "@/lib/intelligence/result-ops";
import { pickStatus } from "@/lib/intelligence/pick-status";
import { resetDb, makeUser, makeFight, pick } from "./helpers";

// The money path, end-to-end against a real DB: grade picks → stats/streak →
// reputation → idempotency. A bug here silently mis-scores the leaderboard.

before(async () => { await resetDb(); });
beforeEach(async () => { await resetDb(); });
after(async () => { await prisma.$disconnect(); });

test("correct pick is graded, streak + reputation awarded", async () => {
  const { red, fight } = await makeFight();
  const user = await makeUser();
  await pick(user.id, fight.id, "RED", 5);
  await prisma.fight.update({ where: { id: fight.id }, data: { result: "WIN", winnerId: red.id } });

  const res = await resolveFightPicks(fight.id);
  assert.equal(res.resolved, 1);

  const graded = await prisma.fightPick.findUniqueOrThrow({ where: { userId_fightId: { userId: user.id, fightId: fight.id } } });
  assert.equal(graded.correct, true);
  const u = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
  assert.equal(u.picksResolved, 1);
  assert.equal(u.picksCorrect, 1);
  assert.equal(u.pickStreak, 1);
  assert.ok(u.reputation > 0, "reputation should be awarded for a correct pick");
});

test("wrong pick is graded false and resets the streak", async () => {
  const { red, fight } = await makeFight();
  const user = await makeUser();
  // Give them a prior streak so we can see it reset.
  await prisma.user.update({ where: { id: user.id }, data: { pickStreak: 4 } });
  await pick(user.id, fight.id, "BLUE");
  await prisma.fight.update({ where: { id: fight.id }, data: { result: "WIN", winnerId: red.id } });

  await resolveFightPicks(fight.id);
  const graded = await prisma.fightPick.findUniqueOrThrow({ where: { userId_fightId: { userId: user.id, fightId: fight.id } } });
  const u = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
  assert.equal(graded.correct, false);
  assert.equal(u.pickStreak, 0);
});

test("resolution is idempotent — a re-run grades nothing again", async () => {
  const { red, fight } = await makeFight();
  const user = await makeUser();
  await pick(user.id, fight.id, "RED");
  await prisma.fight.update({ where: { id: fight.id }, data: { result: "WIN", winnerId: red.id } });

  const first = await resolveFightPicks(fight.id);
  const repAfterFirst = (await prisma.user.findUniqueOrThrow({ where: { id: user.id } })).reputation;
  const second = await resolveFightPicks(fight.id);
  const repAfterSecond = (await prisma.user.findUniqueOrThrow({ where: { id: user.id } })).reputation;

  assert.equal(first.resolved, 1);
  assert.equal(second.resolved, 0, "second run must be a no-op");
  assert.equal(repAfterFirst, repAfterSecond, "reputation must not double-award");
});

test("draw VOIDS the bout — not graded as a miss, no reputation, no streak", async () => {
  const { fight } = await makeFight();
  const user = await makeUser();
  await pick(user.id, fight.id, "RED", 5);
  await prisma.fight.update({ where: { id: fight.id }, data: { result: "DRAW" } });

  await resolveFightPicks(fight.id);
  const graded = await prisma.fightPick.findUniqueOrThrow({ where: { userId_fightId: { userId: user.id, fightId: fight.id } } });
  const u = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
  const f = await prisma.fight.findUniqueOrThrow({ where: { id: fight.id } });

  // A void bout used to be stored as correct=false, which rendered the pick as a
  // MISS while picksResolved deliberately stayed 0 — the profile said 0/0 and the
  // list showed a red X. Void picks stay ungraded; the FIGHT's picksResolvedAt
  // stamp marks the bout settled, and pickStatus derives VOID from the result.
  assert.equal(graded.correct, null, "a void bout must not grade the pick as wrong");
  assert.equal(pickStatus(graded, f), "VOID");
  assert.equal(u.picksResolved, 0, "a void bout does not count toward the record");
  assert.equal(u.reputation, 0, "a void bout pays nothing");
  assert.ok(f.picksResolvedAt, "the bout must still be stamped settled so it stops recurring");
});

test("a void bout is not counted as settlement DRIFT — it is settled", async () => {
  // unsettledPicks must count only DECISIVE results. Counting void picks would make
  // the invariant metric permanently non-zero and therefore useless.
  const { fight } = await makeFight();
  const user = await makeUser();
  await pick(user.id, fight.id, "RED");
  await prisma.fight.update({ where: { id: fight.id }, data: { result: "NO_CONTEST" } });
  await resolveFightPicks(fight.id);

  assert.equal((await resultOps()).unsettledPicks, 0, "a void bout is settled, not drift");
});

// ── The invariant: a written result converges automatically ─────────────────

test("onResultWritten settles immediately — no cron tick required", async () => {
  // THE BUG. resolveFightPicks had exactly one caller (the resolve-picks cron), so a
  // result written by ingest or by an operator left every prediction on the bout
  // open until the next tick — and on Vercel, where that cron was never registered,
  // indefinitely. The write itself must converge.
  const { red, fight } = await makeFight();
  const user = await makeUser();
  await pick(user.id, fight.id, "RED", 4);
  await prisma.fight.update({ where: { id: fight.id }, data: { result: "WIN", winnerId: red.id } });

  const out = await onResultWritten(fight.id, "test");
  assert.equal(out.settled, true);
  assert.equal(out.resolved, 1);

  const graded = await prisma.fightPick.findUniqueOrThrow({ where: { userId_fightId: { userId: user.id, fightId: fight.id } } });
  const f = await prisma.fight.findUniqueOrThrow({ where: { id: fight.id } });
  assert.equal(graded.correct, true);
  assert.equal(pickStatus(graded, f), "SETTLED_CORRECT");

  const u = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
  assert.equal(u.picksResolved, 1);
  assert.equal(u.picksCorrect, 1);
  assert.ok(u.reputation > 0);

  assert.equal((await resultOps()).unsettledPicks, 0);
});

test("CONCURRENT settlement awards exactly once", async () => {
  // With two triggers (the write hook AND the cron) runs can overlap, and
  // awardReputation appends a ledger row unconditionally. The atomic claim
  // (updateMany WHERE correct IS NULL) is what makes the payout exactly-once.
  const { red, fight } = await makeFight();
  const users = await Promise.all([makeUser(), makeUser(), makeUser()]);
  for (const u of users) await pick(u.id, fight.id, "RED", 5);
  await prisma.fight.update({ where: { id: fight.id }, data: { result: "WIN", winnerId: red.id } });

  const runs = await Promise.all(Array.from({ length: 5 }, () => onResultWritten(fight.id, "race")));
  assert.equal(
    runs.reduce((n, r) => n + r.resolved, 0),
    users.length,
    "exactly one runner may claim each pick",
  );

  for (const u of users) {
    const fresh = await prisma.user.findUniqueOrThrow({ where: { id: u.id } });
    assert.equal(fresh.picksResolved, 1, "picksResolved must not double-count");
    assert.equal(fresh.picksCorrect, 1, "picksCorrect must not double-count");
    const ledger = await prisma.reputationEvent.findMany({
      where: { userId: u.id, refType: "fight", refId: fight.id, reason: "pick_correct" },
    });
    assert.equal(ledger.length, 1, "reputation must be awarded exactly once");
    assert.equal(fresh.reputation, ledger[0].delta, "user.reputation must match the ledger");
  }
});

test("the reconciler repairs a settlement that never ran", async () => {
  // The safety net: a result written with the hook bypassed (a direct DB write, a
  // crashed process) must still converge on the next reconciliation pass.
  const { red, fight } = await makeFight();
  const user = await makeUser();
  await pick(user.id, fight.id, "RED");
  await prisma.fight.update({ where: { id: fight.id }, data: { result: "WIN", winnerId: red.id } });

  assert.equal((await resultOps()).unsettledPicks, 1, "drift must be visible BY NAME before repair");

  const out = await resolveDuePicks();
  assert.equal(out.fights, 1);
  assert.equal(out.picks, 1);
  assert.equal((await resultOps()).unsettledPicks, 0, "reconciliation must clear the drift");

  const again = await resolveDuePicks();
  assert.equal(again.fights, 0, "reconciliation is idempotent");
  const u = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
  assert.equal(u.picksCorrect, 1);
});

test("the reconciler covers a decided bout whose only debt is an open BATTLE", async () => {
  // The old due-query required `picks: { some: {} }`, so a decided bout carrying an
  // open battle and no picks was never selected and that battle stayed open forever.
  const { red, fight } = await makeFight();
  const [a, b] = await Promise.all([makeUser(), makeUser()]);
  const battle = await prisma.battle.create({
    data: {
      fightId: fight.id,
      challengerId: a.id,
      challengerCorner: "RED",
      opponentId: b.id,
      opponentCorner: "BLUE",
      state: "ACTIVE",
    },
  });
  await prisma.fight.update({ where: { id: fight.id }, data: { result: "WIN", winnerId: red.id } });

  await resolveDuePicks();
  const fresh = await prisma.battle.findUniqueOrThrow({ where: { id: battle.id } });
  assert.equal(fresh.state, "RESOLVED", "a decided bout must not leave a battle open");
  assert.equal((await resultOps()).unsettledBattles, 0);
});

test("the challenge resolves to the side whose call landed", async () => {
  const { red, fight } = await makeFight();
  const [winnerUser, loserUser] = await Promise.all([makeUser(), makeUser()]);
  await pick(winnerUser.id, fight.id, "RED", 5);
  await pick(loserUser.id, fight.id, "BLUE", 5);
  const battle = await prisma.battle.create({
    data: {
      fightId: fight.id,
      challengerId: winnerUser.id,
      challengerCorner: "RED",
      opponentId: loserUser.id,
      opponentCorner: "BLUE",
      state: "ACTIVE",
    },
  });
  await prisma.fight.update({ where: { id: fight.id }, data: { result: "WIN", winnerId: red.id } });

  await onResultWritten(fight.id, "test");

  const fresh = await prisma.battle.findUniqueOrThrow({ where: { id: battle.id } });
  assert.equal(fresh.state, "RESOLVED");
  assert.equal(fresh.winnerId, winnerUser.id);
  assert.equal(fresh.loserId, loserUser.id);
  assert.equal(fresh.resolvedSource, "fight_result");
});

test("settlement notifies both a hit and a miss", async () => {
  const { red, fight } = await makeFight();
  const [hitUser, missUser] = await Promise.all([makeUser(), makeUser()]);
  await pick(hitUser.id, fight.id, "RED");
  await pick(missUser.id, fight.id, "BLUE");
  await prisma.fight.update({ where: { id: fight.id }, data: { result: "WIN", winnerId: red.id } });

  await onResultWritten(fight.id, "test");

  for (const u of [hitUser, missUser]) {
    const n = await prisma.notification.findMany({ where: { userId: u.id, type: "PICK_RESULT" } });
    assert.ok(n.length >= 1, "every graded picker is told what happened");
  }
});

test("winnerId stored as a SLUG still resolves the correct corner", async () => {
  const { red, fight } = await makeFight();
  const user = await makeUser();
  await pick(user.id, fight.id, "RED");
  await prisma.fight.update({ where: { id: fight.id }, data: { result: "WIN", winnerId: red.slug } });

  await resolveFightPicks(fight.id);
  const graded = await prisma.fightPick.findUniqueOrThrow({ where: { userId_fightId: { userId: user.id, fightId: fight.id } } });
  assert.equal(graded.correct, true);
});
