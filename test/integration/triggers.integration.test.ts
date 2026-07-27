import { test, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "@/lib/db";
import { toggleFollow } from "@/lib/follow-targets";
import { notifyEventChanges, notifyOfficialResults, snapshotEvent } from "@/lib/social/event-triggers";
import {
  notifyFightAnnounced, notifyFightCancelled, notifyFightChanges,
  notifyRankingChange, notifyFighterVerified, notifyFighterProfileUpdate,
  snapshotFight,
} from "@/lib/social/fighter-triggers";
import {
  notifyCardMilestone, notifyStreakMilestone, notifyPersonVerified, notifyCommunityMilestone,
} from "@/lib/social/person-triggers";
import { resetDb, makeUser, makeFighter, makeFight } from "./helpers";

// Every trigger added in this sprint, against the real database. The properties
// under test are the same three every time:
//   • the right AUDIENCE is reached (and nobody else)
//   • a re-run is silent (the dedupeKey describes the FACT, not the run)
//   • the deep link goes to the thing, not to a generic page

beforeEach(async () => { await resetDb(); });
after(async () => { await prisma.$disconnect(); });

let seq = 0;
const uniq = (p: string) => `${p}-${seq++}`;
const soon = () => new Date(Date.now() + 14 * 24 * 3600_000);

async function makeEvent(over: Record<string, unknown> = {}) {
  return prisma.event.create({
    data: {
      slug: uniq("evt"), name: "Test Card", sport: "MMA",
      date: soon(), status: "SCHEDULED", promotion: "UFC", ...over,
    },
  });
}

const notesFor = (userId: string) =>
  prisma.notification.findMany({ where: { userId }, orderBy: { createdAt: "asc" } });

// ── event lifecycle ─────────────────────────────────────────────────────────

test("a NEW event is announced to the promotion's followers", async () => {
  const fan = await makeUser();
  await toggleFollow(fan.id, { type: "promotion", id: "ufc" }, true);

  const event = await makeEvent();
  await notifyEventChanges(null, event.id);

  const notes = await notesFor(fan.id);
  assert.equal(notes.length, 1);
  assert.equal(notes[0].dedupeKey, `event_announced:${event.id}`);
  assert.match(notes[0].url ?? "", /^\/events\//);
});

test("a DRAFT event notifies nobody — it is on no public surface", async () => {
  const fan = await makeUser();
  await toggleFollow(fan.id, { type: "promotion", id: "ufc" }, true);

  const event = await makeEvent({ status: "DRAFT" });
  await notifyEventChanges(null, event.id);
  assert.equal(await prisma.notification.count({ where: { userId: fan.id } }), 0);
});

test("publishing a DRAFT is the announcement", async () => {
  const fan = await makeUser();
  await toggleFollow(fan.id, { type: "promotion", id: "ufc" }, true);

  const event = await makeEvent({ status: "DRAFT" });
  const before = await snapshotEvent({ id: event.id });
  await prisma.event.update({ where: { id: event.id }, data: { status: "ANNOUNCED" } });
  await notifyEventChanges(before, event.id);

  const notes = await notesFor(fan.id);
  assert.equal(notes.length, 1, "a card going public is news even though the row existed");
  assert.equal(notes[0].dedupeKey, `event_announced:${event.id}`);
});

test("an unknown promotion contributes no audience but does not throw", async () => {
  const fan = await makeUser();
  await toggleFollow(fan.id, { type: "promotion", id: "ufc" }, true);
  // "Various" resolves to the neutral fallback, which is not an organisation
  // anybody can follow.
  const event = await makeEvent({ promotion: "Various" });
  await notifyEventChanges(null, event.id);
  assert.equal(await prisma.notification.count({ where: { userId: fan.id } }), 0);
});

test("a cancelled event tells its followers, once", async () => {
  const [fan, event] = [await makeUser(), await makeEvent()];
  await toggleFollow(fan.id, { type: "event", id: event.id }, true);

  const before = await snapshotEvent({ id: event.id });
  await prisma.event.update({ where: { id: event.id }, data: { status: "CANCELLED" } });
  await notifyEventChanges(before, event.id);
  await notifyEventChanges(before, event.id); // a second ingest tick

  const notes = await notesFor(fan.id);
  assert.equal(notes.length, 1, "the dedupeKey holds across re-runs");
  assert.equal(notes[0].dedupeKey, `event_cancelled:${event.id}`);
});

test("an event going LIVE shares the Return Engine's key, so it is announced once", async () => {
  const [fan, event] = [await makeUser(), await makeEvent()];
  await toggleFollow(fan.id, { type: "event", id: event.id }, true);

  const before = await snapshotEvent({ id: event.id });
  await prisma.event.update({ where: { id: event.id }, data: { status: "LIVE" } });
  await notifyEventChanges(before, event.id);

  const notes = await notesFor(fan.id);
  assert.equal(notes.length, 1);
  assert.equal(notes[0].type, "EVENT_LIVE");
  // The exact key the cron uses — whichever observes the transition first wins.
  assert.equal(notes[0].dedupeKey, `event_live:${event.id}`);
});

test("a rescheduled event is keyed by its NEW date, so a second move is a second fact", async () => {
  const [fan, event] = [await makeUser(), await makeEvent()];
  await toggleFollow(fan.id, { type: "event", id: event.id }, true);

  const first = await snapshotEvent({ id: event.id });
  const moved = new Date(+event.date + 7 * 24 * 3600_000);
  await prisma.event.update({ where: { id: event.id }, data: { date: moved } });
  await notifyEventChanges(first, event.id);

  const second = await snapshotEvent({ id: event.id });
  const movedAgain = new Date(+moved + 7 * 24 * 3600_000);
  await prisma.event.update({ where: { id: event.id }, data: { date: movedAgain } });
  await notifyEventChanges(second, event.id);

  assert.equal(await prisma.notification.count({ where: { userId: fan.id } }), 2);
});

test("a clock correction under an hour is not a reschedule", async () => {
  const [fan, event] = [await makeUser(), await makeEvent()];
  await toggleFollow(fan.id, { type: "event", id: event.id }, true);

  const before = await snapshotEvent({ id: event.id });
  await prisma.event.update({
    where: { id: event.id },
    data: { date: new Date(+event.date + 10 * 60_000) },
  });
  await notifyEventChanges(before, event.id);
  assert.equal(await prisma.notification.count({ where: { userId: fan.id } }), 0);
});

test("a card gaining its first bouts is published — ONE notification, not one per bout", async () => {
  const [fan, event] = [await makeUser(), await makeEvent()];
  await toggleFollow(fan.id, { type: "event", id: event.id }, true);
  const before = await snapshotEvent({ id: event.id });

  const fighters = await Promise.all([makeFighter("A"), makeFighter("B"), makeFighter("C"), makeFighter("D")]);
  for (let i = 0; i < 2; i++) {
    await prisma.fight.create({
      data: {
        slug: uniq("f"), eventId: event.id, date: event.date,
        redId: fighters[i * 2].id, blueId: fighters[i * 2 + 1].id,
        orderOnCard: i, mainEvent: i === 0,
      },
    });
  }
  await notifyEventChanges(before, event.id);

  const notes = await notesFor(fan.id);
  assert.equal(notes.length, 1, "a two-bout card is one card-level notification");
  assert.equal(notes[0].dedupeKey, `card_published:${event.id}`);
  assert.match(notes[0].url ?? "", /#card$/);
});

test("a main event swap is announced, keyed by the new pairing", async () => {
  const [fan, event] = [await makeUser(), await makeEvent()];
  await toggleFollow(fan.id, { type: "event", id: event.id }, true);

  const [a, b, c, d] = await Promise.all([makeFighter("A"), makeFighter("B"), makeFighter("C"), makeFighter("D")]);
  const head = await prisma.fight.create({
    data: { slug: uniq("f"), eventId: event.id, date: event.date, redId: a.id, blueId: b.id, mainEvent: true, orderOnCard: 0 },
  });
  const before = await snapshotEvent({ id: event.id });

  // The original headline is scratched and a new bout takes the top of the card.
  await prisma.fight.update({ where: { id: head.id }, data: { cancelled: true, mainEvent: false } });
  await prisma.fight.create({
    data: { slug: uniq("f"), eventId: event.id, date: event.date, redId: c.id, blueId: d.id, mainEvent: true, orderOnCard: 0 },
  });
  await notifyEventChanges(before, event.id);

  const notes = await notesFor(fan.id);
  const main = notes.find((n) => n.dedupeKey?.startsWith("main_event:"));
  assert.ok(main, "the headline change was announced");
  assert.match(main.title, /New main event/);
});

test("official results fire once the whole card is decided — and not before", async () => {
  const { red, event, fight } = await makeFight();
  await prisma.event.update({ where: { id: event.id }, data: { promotion: "UFC" } });
  const fan = await makeUser();
  await toggleFollow(fan.id, { type: "event", id: event.id }, true);

  // A second, still-scheduled bout means the night is not over.
  const [c, d] = await Promise.all([makeFighter("C"), makeFighter("D")]);
  const second = await prisma.fight.create({
    data: { slug: uniq("f"), eventId: event.id, date: event.date, redId: c.id, blueId: d.id },
  });
  await prisma.fight.update({ where: { id: fight.id }, data: { result: "WIN", winnerId: red.id } });

  assert.equal(await notifyOfficialResults(event.id), false, "one ungraded bout means not yet");
  assert.equal(await prisma.notification.count({ where: { userId: fan.id } }), 0);

  await prisma.fight.update({ where: { id: second.id }, data: { result: "WIN", winnerId: c.id } });
  assert.equal(await notifyOfficialResults(event.id), true);
  assert.equal(await notifyOfficialResults(event.id), false, "and only once");

  const notes = await notesFor(fan.id);
  assert.equal(notes.length, 1);
  assert.equal(notes[0].dedupeKey, `event_results:${event.id}`);
});

test("COMPLETED and 'official results' are ONE notification, not two", async () => {
  // Both used to fire, with near-identical copy and the same deep link — the same
  // sentence twice. They share one key now, so whichever observation lands first wins.
  const { red, event, fight } = await makeFight();
  await prisma.event.update({ where: { id: event.id }, data: { promotion: "UFC" } });
  const fan = await makeUser();
  await toggleFollow(fan.id, { type: "event", id: event.id }, true);
  await prisma.fight.update({ where: { id: fight.id }, data: { result: "WIN", winnerId: red.id } });

  // The results write gets there first…
  await notifyOfficialResults(event.id);
  // …then the operator marks the card completed.
  const before = await snapshotEvent({ id: event.id });
  await prisma.event.update({ where: { id: event.id }, data: { status: "COMPLETED" } });
  await notifyEventChanges(before, event.id);

  const notes = await notesFor(fan.id);
  assert.equal(notes.length, 1, "one fact, one notification");
  assert.equal(notes[0].dedupeKey, `event_results:${event.id}`);
});

test("a card marked COMPLETED with no results yet stays quiet", async () => {
  // Announcing "official results" for a card that has none is worse than silence.
  const [fan, event] = [await makeUser(), await makeEvent()];
  await toggleFollow(fan.id, { type: "event", id: event.id }, true);
  const before = await snapshotEvent({ id: event.id });
  await prisma.event.update({ where: { id: event.id }, data: { status: "COMPLETED" } });
  await notifyEventChanges(before, event.id);
  assert.equal(await prisma.notification.count({ where: { userId: fan.id } }), 0);
});

test("an empty card is never 'complete'", async () => {
  const [fan, event] = [await makeUser(), await makeEvent()];
  await toggleFollow(fan.id, { type: "event", id: event.id }, true);
  assert.equal(await notifyOfficialResults(event.id), false);
});

// ── fight / fighter ─────────────────────────────────────────────────────────

test("a new bout tells both corners' followers, not the event's", async () => {
  const { red, blue, event, fight } = await makeFight();
  await prisma.event.update({ where: { id: event.id }, data: { date: soon() } });
  await prisma.fight.update({ where: { id: fight.id }, data: { date: soon() } });

  const [redFan, blueFan, eventFan] = await Promise.all([makeUser(), makeUser(), makeUser()]);
  await toggleFollow(redFan.id, { type: "fighter", id: red.id }, true);
  await toggleFollow(blueFan.id, { type: "fighter", id: blue.id }, true);
  await toggleFollow(eventFan.id, { type: "event", id: event.id }, true);

  await notifyFightAnnounced(fight.id);

  assert.equal((await notesFor(redFan.id)).length, 1);
  assert.equal((await notesFor(blueFan.id)).length, 1);
  assert.equal(
    (await notesFor(eventFan.id)).length, 0,
    "the card-level trigger tells event followers — one row for the whole card, not one per bout",
  );
});

test("a bout that arrives already DECIDED is history, not a booking", async () => {
  const { red, blue, fight } = await makeFight();
  const fan = await makeUser();
  await toggleFollow(fan.id, { type: "fighter", id: red.id }, true);
  await prisma.fight.update({ where: { id: fight.id }, data: { result: "WIN", winnerId: blue.id } });

  assert.equal(await notifyFightAnnounced(fight.id), 0);
  assert.equal(await prisma.notification.count({ where: { userId: fan.id } }), 0);
});

test("a bout in the PAST is never announced as booked", async () => {
  const { red, fight } = await makeFight();
  const fan = await makeUser();
  await toggleFollow(fan.id, { type: "fighter", id: red.id }, true);
  await prisma.fight.update({
    where: { id: fight.id },
    data: { date: new Date(Date.now() - 30 * 24 * 3600_000) },
  });
  assert.equal(await notifyFightAnnounced(fight.id), 0);
});

test("a scratched bout carries the operator's own reason", async () => {
  const { red, event, fight } = await makeFight();
  await prisma.event.update({ where: { id: event.id }, data: { promotion: "UFC" } });
  const fan = await makeUser();
  await toggleFollow(fan.id, { type: "fighter", id: red.id }, true);
  await prisma.fight.update({
    where: { id: fight.id },
    data: { cancelled: true, cardNote: "Jones out — injury" },
  });

  await notifyFightCancelled(fight.id);
  const notes = await notesFor(fan.id);
  assert.equal(notes.length, 1);
  assert.equal(notes[0].body, "Jones out — injury", "the operator's words beat anything generated");
  assert.match(notes[0].url ?? "", /#fight-/, "deep-links to the BOUT");
});

test("the fight diff picks cancellation over rescheduling", async () => {
  const { red, event, fight } = await makeFight();
  await prisma.event.update({ where: { id: event.id }, data: { promotion: "UFC" } });
  const fan = await makeUser();
  await toggleFollow(fan.id, { type: "fighter", id: red.id }, true);

  const before = await snapshotFight({ id: fight.id });
  // Both changed at once — a scratched bout is the fact that matters.
  await prisma.fight.update({
    where: { id: fight.id },
    data: { cancelled: true, date: new Date(+fight.date + 20 * 24 * 3600_000) },
  });
  const out = await notifyFightChanges(before, fight.id);
  assert.deepEqual(out.facts, ["cancelled"]);
  assert.equal((await notesFor(fan.id)).length, 1);
});

test("a superfan following the fighter AND the event AND the promotion is told once", async () => {
  const { red, blue, event, fight } = await makeFight();
  await prisma.event.update({ where: { id: event.id }, data: { promotion: "UFC" } });
  const superfan = await makeUser();
  for (const t of [
    { type: "fighter" as const, id: red.id },
    { type: "fighter" as const, id: blue.id },
    { type: "event" as const, id: event.id },
    { type: "promotion" as const, id: "ufc" },
  ]) await toggleFollow(superfan.id, t, true);

  await prisma.fight.update({ where: { id: fight.id }, data: { cancelled: true } });
  await notifyFightCancelled(fight.id);
  assert.equal(await prisma.notification.count({ where: { userId: superfan.id } }), 1);
});

// ── rankings ────────────────────────────────────────────────────────────────

test("entering the rankings notifies followers", async () => {
  const fighter = await makeFighter("Riser");
  const fan = await makeUser();
  await toggleFollow(fan.id, { type: "fighter", id: fighter.id }, true);

  const sent = await notifyRankingChange({
    fighterId: fighter.id, weightClass: "Lightweight", rank: 9, previousRank: null,
  });
  assert.equal(sent, 1);
  const notes = await notesFor(fan.id);
  assert.match(notes[0].title, /enters the Lightweight rankings/);
});

test("a one-place shuffle is NOT news — the fighter did nothing", async () => {
  const fighter = await makeFighter("Static");
  const fan = await makeUser();
  await toggleFollow(fan.id, { type: "fighter", id: fighter.id }, true);

  assert.equal(
    await notifyRankingChange({ fighterId: fighter.id, weightClass: "Lightweight", rank: 4, previousRank: 5 }),
    0,
  );
  assert.equal(await prisma.notification.count({ where: { userId: fan.id } }), 0);
});

test("a bounce back to a rank already announced does not re-announce it", async () => {
  const fighter = await makeFighter("Bouncer");
  const fan = await makeUser();
  await toggleFollow(fan.id, { type: "fighter", id: fighter.id }, true);

  await notifyRankingChange({ fighterId: fighter.id, weightClass: "Lightweight", rank: 3, previousRank: 6 });
  await notifyRankingChange({ fighterId: fighter.id, weightClass: "Lightweight", rank: 6, previousRank: 3 });
  await notifyRankingChange({ fighterId: fighter.id, weightClass: "Lightweight", rank: 3, previousRank: 6 });

  // #3 once, #6 once — the third call is the same fact as the first.
  assert.equal(await prisma.notification.count({ where: { userId: fan.id } }), 2);
});

test("entering at the bottom of a long list is not a milestone", async () => {
  const fighter = await makeFighter("Bubble");
  const fan = await makeUser();
  await toggleFollow(fan.id, { type: "fighter", id: fighter.id }, true);
  assert.equal(
    await notifyRankingChange({ fighterId: fighter.id, weightClass: "Lightweight", rank: 40, previousRank: null }),
    0,
  );
});

test("a follower who muted FIGHTS hears nothing about rank movement", async () => {
  const fighter = await makeFighter("Muted");
  const fan = await makeUser();
  await toggleFollow(fan.id, { type: "fighter", id: fighter.id }, true);
  await prisma.user.update({ where: { id: fan.id }, data: { notifyFights: false } });
  assert.equal(
    await notifyRankingChange({ fighterId: fighter.id, weightClass: "Lightweight", rank: 2, previousRank: null }),
    0,
  );
});

// ── verification + profile ──────────────────────────────────────────────────

test("a claimed fighter is announced to followers, excluding the new owner", async () => {
  const fighter = await makeFighter("Claimed");
  const [fan, owner] = [await makeUser(), await makeUser()];
  await toggleFollow(fan.id, { type: "fighter", id: fighter.id }, true);
  await toggleFollow(owner.id, { type: "fighter", id: fighter.id }, true);
  await prisma.fighter.update({ where: { id: fighter.id }, data: { claimed: true, ownerId: owner.id } });

  await notifyFighterVerified(fighter.id);
  assert.equal((await notesFor(fan.id)).length, 1);
  assert.equal((await notesFor(owner.id)).length, 0, "they know — they claimed it");
});

test("an UNCLAIMED fighter's profile change is maintenance, not news", async () => {
  const fighter = await makeFighter("Scraped");
  const fan = await makeUser();
  await toggleFollow(fan.id, { type: "fighter", id: fighter.id }, true);
  assert.equal(await notifyFighterProfileUpdate(fighter.id, { tagline: "New era" }), 0);
});

test("a claimed fighter's tagline change reaches followers, once per value", async () => {
  const fighter = await makeFighter("Owner");
  const fan = await makeUser();
  await toggleFollow(fan.id, { type: "fighter", id: fighter.id }, true);
  await prisma.fighter.update({ where: { id: fighter.id }, data: { claimed: true } });

  await notifyFighterProfileUpdate(fighter.id, { tagline: "New era" });
  await notifyFighterProfileUpdate(fighter.id, { tagline: "New era" });
  assert.equal(await prisma.notification.count({ where: { userId: fan.id } }), 1);
});

// ── people ──────────────────────────────────────────────────────────────────

test("a rare card reaches the person's followers; a base card does not", async () => {
  const [star, fan] = [await makeUser(), await makeUser()];
  await toggleFollow(fan.id, { type: "person", id: star.id }, true);

  assert.equal(
    await notifyCardMilestone(star.id, { rarity: "BASE", fighterName: "Someone", cardId: "c1" }),
    0,
    "a base card is a Tuesday",
  );
  assert.equal(
    await notifyCardMilestone(star.id, { rarity: "LEGEND", fighterName: "Usyk", cardId: "c2" }),
    1,
  );
  assert.equal(await prisma.notification.count({ where: { userId: fan.id } }), 1);
});

test("a streak is announced at the lines only, and never to the person themself", async () => {
  const [star, fan] = [await makeUser(), await makeUser()];
  await toggleFollow(fan.id, { type: "person", id: star.id }, true);

  assert.equal(await notifyStreakMilestone(star.id, 3, 4), 0, "4 is not a line");
  assert.equal(await notifyStreakMilestone(star.id, 4, 5), 1);
  assert.equal(await notifyStreakMilestone(star.id, 5, 6), 0, "6 is not a line either");

  assert.equal(await prisma.notification.count({ where: { userId: fan.id } }), 1);
  // Scoped to the milestone TYPE, not to every row: gaining `fan` as a follower
  // legitimately notified `star` ("fan followed you"), so an unscoped count of
  // zero here was the test's mistake, not the code's. What must be true is that
  // the milestone itself never reaches the person it is about.
  assert.equal(
    await prisma.notification.count({ where: { userId: star.id, dedupeKey: { startsWith: "person_streak:" } } }),
    0,
    "nobody is told about their own milestone",
  );
});

test("a rebuilt streak does not re-announce a line already crossed", async () => {
  const [star, fan] = [await makeUser(), await makeUser()];
  await toggleFollow(fan.id, { type: "person", id: star.id }, true);
  await notifyStreakMilestone(star.id, 4, 5);
  await notifyStreakMilestone(star.id, 0, 5); // broke, rebuilt to the same number
  assert.equal(await prisma.notification.count({ where: { userId: fan.id } }), 1);
});

test("followers hear about reputation at a HIGHER bar than the user's own alert", async () => {
  const [star, fan] = [await makeUser(), await makeUser()];
  await toggleFollow(fan.id, { type: "person", id: star.id }, true);

  assert.equal(await notifyCommunityMilestone(star.id, 90, 120), 0, "100 is encouragement, not news");
  assert.equal(await notifyCommunityMilestone(star.id, 900, 1100), 1);
});

test("a verified badge reaches followers once", async () => {
  const [star, fan] = [await makeUser(), await makeUser()];
  await toggleFollow(fan.id, { type: "person", id: star.id }, true);
  await notifyPersonVerified(star.id, "COACH");
  await notifyPersonVerified(star.id, "COACH");
  assert.equal(await prisma.notification.count({ where: { userId: fan.id } }), 1);
});

test("a follower who muted SOCIAL hears no milestones", async () => {
  const [star, fan] = [await makeUser(), await makeUser()];
  await toggleFollow(fan.id, { type: "person", id: star.id }, true);
  await prisma.user.update({ where: { id: fan.id }, data: { notifySocial: false } });
  assert.equal(await notifyStreakMilestone(star.id, 4, 5), 0);
});
