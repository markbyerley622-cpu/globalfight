import { test, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "@/lib/db";
import {
  toggleFollow, isFollowing, followerCount, followerIdsToNotify, SelfFollowError,
} from "@/lib/follow-targets";
import { notifyGymReview } from "@/lib/gym-notifications";
import { notifyFightResult } from "@/lib/social/triggers";
import { resetDb, makeUser, makeFighter, makeFight } from "./helpers";

// The follow system already existed as three per-entity tables. This sprint adds a
// polymorphic one and ONE API over both, so these pin that the legacy paths still
// work through the new front door and that the new ones behave identically.

beforeEach(async () => { await resetDb(); });
after(async () => { await prisma.$disconnect(); });

let seq = 0;
const uniq = (p: string) => `${p}-${seq++}`;

async function makeGym(ownerId?: string) {
  return prisma.gym.create({
    data: { slug: uniq("gym"), name: "Gracie Gym", ...(ownerId ? { ownerId } : {}) },
  });
}

// ── the unified API ─────────────────────────────────────────────────────────

test("following a GYM works through the polymorphic table", async () => {
  const [u, gym] = [await makeUser(), await makeGym()];
  assert.equal(await isFollowing(u.id, { type: "gym", id: gym.id }), false);

  assert.deepEqual(await toggleFollow(u.id, { type: "gym", id: gym.id }), { following: true });
  assert.equal(await isFollowing(u.id, { type: "gym", id: gym.id }), true);
  assert.equal(await followerCount({ type: "gym", id: gym.id }), 1);

  assert.deepEqual(await toggleFollow(u.id, { type: "gym", id: gym.id }), { following: false });
  assert.equal(await followerCount({ type: "gym", id: gym.id }), 0);
});

test("a legacy FIGHTER follow still works through the same front door", async () => {
  const [u, f] = [await makeUser(), await makeFighter("Jon")];
  await toggleFollow(u.id, { type: "fighter", id: f.id }, true);
  assert.equal(await isFollowing(u.id, { type: "fighter", id: f.id }), true);
  assert.equal(await followerCount({ type: "fighter", id: f.id }), 1);
  // Routed to the ORIGINAL table — no shadow copy in the new one.
  assert.equal(await prisma.favoriteFighter.count(), 1);
  assert.equal(await prisma.follow.count(), 0);
});

test("explicit intent is idempotent — a double tap cannot desync the button", async () => {
  const [u, gym] = [await makeUser(), await makeGym()];
  await toggleFollow(u.id, { type: "gym", id: gym.id }, true);
  await toggleFollow(u.id, { type: "gym", id: gym.id }, true);
  assert.equal(await followerCount({ type: "gym", id: gym.id }), 1, "no duplicate follow");
  await toggleFollow(u.id, { type: "gym", id: gym.id }, false);
  await toggleFollow(u.id, { type: "gym", id: gym.id }, false);
  assert.equal(await followerCount({ type: "gym", id: gym.id }), 0);
});

test("the database refuses a duplicate follow even if two requests race", async () => {
  const [u, gym] = [await makeUser(), await makeGym()];
  const results = await Promise.allSettled(
    Array.from({ length: 5 }, () => prisma.follow.create({
      data: { userId: u.id, targetType: "gym", targetId: gym.id },
    })),
  );
  assert.equal(results.filter((r) => r.status === "fulfilled").length, 1, "the unique holds");
  assert.equal(await followerCount({ type: "gym", id: gym.id }), 1);
});

test("a person cannot follow themselves", async () => {
  const u = await makeUser();
  await assert.rejects(() => toggleFollow(u.id, { type: "person", id: u.id }, true), SelfFollowError);
  assert.equal(await prisma.follow.count(), 0);
});

// ── preferences are not bypassable ──────────────────────────────────────────

test("followerIdsToNotify drops users who muted the category", async () => {
  const [a, b, gym] = [await makeUser(), await makeUser(), await makeGym()];
  await toggleFollow(a.id, { type: "gym", id: gym.id }, true);
  await toggleFollow(b.id, { type: "gym", id: gym.id }, true);
  await prisma.user.update({ where: { id: b.id }, data: { notifyGym: false } });

  const ids = await followerIdsToNotify({ type: "gym", id: gym.id });
  assert.deepEqual(ids, [a.id], "a muted follower is simply not in the list");
});

test("followerIdsToNotify excludes the actor", async () => {
  const [a, gym] = [await makeUser(), await makeGym()];
  await toggleFollow(a.id, { type: "gym", id: gym.id }, true);
  assert.deepEqual(await followerIdsToNotify({ type: "gym", id: gym.id }, { exclude: [a.id] }), []);
});

// ── the review pipeline ─────────────────────────────────────────────────────

test("a new review notifies the gym OWNER and every follower", async () => {
  const owner = await makeUser();
  const gym = await makeGym(owner.id);
  const [follower, author] = [await makeUser(), await makeUser()];
  await toggleFollow(follower.id, { type: "gym", id: gym.id }, true);

  const out = await notifyGymReview(gym.id, author.id, "created");
  assert.equal(out.owner, true);
  assert.equal(out.followers, 1);

  const ownerNotes = await prisma.notification.findMany({ where: { userId: owner.id } });
  assert.equal(ownerNotes.length, 1);
  assert.equal(ownerNotes[0].type, "GYM_REVIEW");
  assert.match(ownerNotes[0].url ?? "", /^\/gyms\/.+#reviews$/, "deep-links to the reviews, not the profile");

  assert.equal(await prisma.notification.count({ where: { userId: follower.id } }), 1);
  assert.equal(await prisma.notification.count({ where: { userId: author.id } }), 0, "never notify the author");
});

test("an EDIT tells the owner but not the followers", async () => {
  const owner = await makeUser();
  const gym = await makeGym(owner.id);
  const [follower, author] = [await makeUser(), await makeUser()];
  await toggleFollow(follower.id, { type: "gym", id: gym.id }, true);

  const out = await notifyGymReview(gym.id, author.id, "edited");
  assert.equal(out.owner, true);
  assert.equal(out.followers, 0, "followers do not care that a typo was fixed");
  assert.equal(await prisma.notification.count({ where: { userId: follower.id } }), 0);
});

test("an owner who muted gym notifications is not notified", async () => {
  const owner = await makeUser();
  await prisma.user.update({ where: { id: owner.id }, data: { notifyGym: false } });
  const gym = await makeGym(owner.id);
  const author = await makeUser();

  const out = await notifyGymReview(gym.id, author.id, "created");
  assert.equal(out.owner, false, "owning a gym is not consent to be notified");
  assert.equal(await prisma.notification.count({ where: { userId: owner.id } }), 0);
});

test("an owner reviewing their own gym is not notified about it", async () => {
  const owner = await makeUser();
  const gym = await makeGym(owner.id);
  const out = await notifyGymReview(gym.id, owner.id, "created");
  assert.equal(out.owner, false);
  assert.equal(await prisma.notification.count({ where: { userId: owner.id } }), 0);
});

test("the same review notified twice does not double-notify", async () => {
  const owner = await makeUser();
  const gym = await makeGym(owner.id);
  const author = await makeUser();
  await notifyGymReview(gym.id, author.id, "created");
  await notifyGymReview(gym.id, author.id, "created");
  assert.equal(await prisma.notification.count({ where: { userId: owner.id } }), 1, "dedupeKey holds");
});

test("a missing gym is survivable — the review still saved", async () => {
  const author = await makeUser();
  const out = await notifyGymReview("does-not-exist", author.id, "created");
  assert.deepEqual(out, { owner: false, followers: 0 });
});

// ── fight-result fan-out ────────────────────────────────────────────────────
// Distinct from pick payouts: those reward people who CALLED the bout. This tells
// everyone who follows either fighter, the event or the promotion — whether or not
// they predicted.

test("a decided bout notifies followers of BOTH fighters, the event and the promotion", async () => {
  const { red, blue, event, fight } = await makeFight();
  await prisma.event.update({ where: { id: event.id }, data: { promotion: "UFC" } });
  const [a, b, c, d] = await Promise.all([makeUser(), makeUser(), makeUser(), makeUser()]);
  await toggleFollow(a.id, { type: "fighter", id: red.id }, true);
  await toggleFollow(b.id, { type: "fighter", id: blue.id }, true);
  await toggleFollow(c.id, { type: "event", id: event.id }, true);
  await toggleFollow(d.id, { type: "promotion", id: "ufc" }, true);
  await prisma.fight.update({ where: { id: fight.id }, data: { result: "WIN", winnerId: red.id, method: "KO", roundEnded: 2 } });

  const out = await notifyFightResult(fight.id);
  assert.equal(out.notified, 4, "every audience is told");
  for (const u of [a, b, c, d]) {
    const n = await prisma.notification.findMany({ where: { userId: u.id } });
    assert.equal(n.length, 1, `follower ${u.id} got ${n.length}`);
    assert.match(n[0].url ?? "", /^\/events\/.+#fight-/, "deep-links to the BOUT, not the event");
  }
});

test("a reader following EVERYTHING is told once, not four times", async () => {
  // The anti-spam property: one real-world fact, one dedupeKey, one notification —
  // enforced by the (userId, dedupeKey) unique rather than by each trigger hoping
  // the others stayed quiet.
  const { red, blue, event, fight } = await makeFight();
  await prisma.event.update({ where: { id: event.id }, data: { promotion: "UFC" } });
  const superfan = await makeUser();
  await toggleFollow(superfan.id, { type: "fighter", id: red.id }, true);
  await toggleFollow(superfan.id, { type: "fighter", id: blue.id }, true);
  await toggleFollow(superfan.id, { type: "event", id: event.id }, true);
  await toggleFollow(superfan.id, { type: "promotion", id: "ufc" }, true);
  await prisma.fight.update({ where: { id: fight.id }, data: { result: "WIN", winnerId: red.id } });

  await notifyFightResult(fight.id);
  assert.equal(await prisma.notification.count({ where: { userId: superfan.id } }), 1);
});

test("re-running the fan-out sends nothing new", async () => {
  const { red, event, fight } = await makeFight();
  const u = await makeUser();
  await toggleFollow(u.id, { type: "event", id: event.id }, true);
  await prisma.fight.update({ where: { id: fight.id }, data: { result: "WIN", winnerId: red.id } });

  await notifyFightResult(fight.id);
  await notifyFightResult(fight.id);
  assert.equal(await prisma.notification.count({ where: { userId: u.id } }), 1);
});

test("an undecided bout notifies nobody", async () => {
  const { event, fight } = await makeFight();
  const u = await makeUser();
  await toggleFollow(u.id, { type: "event", id: event.id }, true);
  assert.deepEqual(await notifyFightResult(fight.id), { notified: 0 });
  assert.equal(await prisma.notification.count({ where: { userId: u.id } }), 0);
});

test("a follower who muted FIGHT notifications gets nothing", async () => {
  const { red, event, fight } = await makeFight();
  const u = await makeUser();
  await prisma.user.update({ where: { id: u.id }, data: { notifyFights: false } });
  await toggleFollow(u.id, { type: "event", id: event.id }, true);
  await prisma.fight.update({ where: { id: fight.id }, data: { result: "WIN", winnerId: red.id } });

  await notifyFightResult(fight.id);
  assert.equal(await prisma.notification.count({ where: { userId: u.id } }), 0, "disabled means not generated");
});
