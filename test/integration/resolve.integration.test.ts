import { test, before, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "@/lib/db";
import { resolveFightPicks } from "@/lib/intelligence/resolve";
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

test("draw voids the bout — pick false, no reputation, no streak", async () => {
  const { fight } = await makeFight();
  const user = await makeUser();
  await pick(user.id, fight.id, "RED", 5);
  await prisma.fight.update({ where: { id: fight.id }, data: { result: "DRAW" } });

  await resolveFightPicks(fight.id);
  const graded = await prisma.fightPick.findUniqueOrThrow({ where: { userId_fightId: { userId: user.id, fightId: fight.id } } });
  const u = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
  assert.equal(graded.correct, false);
  assert.equal(u.reputation, 0, "a void bout pays nothing");
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
