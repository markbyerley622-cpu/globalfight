import { test, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "@/lib/db";
import { persistAggregated } from "@/services/sync/persist";
import type { NormalizedEvent } from "@/services/providers/types";
import { resetDb, makeFight, makeUser, pick } from "./helpers";

beforeEach(async () => { await resetDb(); });
after(async () => { await prisma.$disconnect(); });

// ── Cascade-delete guard (Wave 0: Fight corners onDelete Restrict) ────────────

test("deleting a fighter who has a bout is REFUSED (no history loss)", async () => {
  const { red } = await makeFight();
  await assert.rejects(
    () => prisma.fighter.delete({ where: { id: red.id } }),
    /Foreign key constraint|violat|Restrict|P2003/i,
    "the DB must refuse to delete a fighter referenced by a Fight",
  );
  // The fighter — and therefore the shared bout — is still there.
  assert.ok(await prisma.fighter.findUnique({ where: { id: red.id } }));
});

// ── Persistence atomicity + dedup (Wave 1: per-fight transaction) ─────────────

const eventFixture = (externalId: string): NormalizedEvent => ({
  externalId,
  name: "Persist Card",
  sport: "MMA",
  date: new Date(Date.now() + 7 * 86_400_000).toISOString(),
  status: "SCHEDULED",
  fights: [{ redName: "Alpha One", blueName: "Beta Two", scheduledRounds: 3 }],
  _meta: { source: "test", confidence: 0.9, lastUpdated: new Date().toISOString(), externalId },
});

test("persistAggregated lands an event with its bout and both corner fighters", async () => {
  await persistAggregated("MMA", "events", [eventFixture("src-1")]);

  assert.equal(await prisma.event.count(), 1);
  assert.equal(await prisma.fight.count(), 1);
  assert.equal(await prisma.fighter.count(), 2);

  const fight = await prisma.fight.findFirstOrThrow({ include: { red: true, blue: true } });
  // No orphan corners: the fight references real, persisted fighters.
  assert.ok(fight.red.name && fight.blue.name);
});

test("re-persisting the same card is idempotent (upsert, no duplicates)", async () => {
  await persistAggregated("MMA", "events", [eventFixture("src-1")]);
  await persistAggregated("MMA", "events", [eventFixture("src-1")]);

  assert.equal(await prisma.event.count(), 1, "event deduped on slug");
  assert.equal(await prisma.fight.count(), 1, "fight deduped on slug");
  assert.equal(await prisma.fighter.count(), 2, "fighters deduped, not re-created");
});

// ── Fight IDENTITY across pipelines (the production shape) ────────────────────
// Production's boxing/MMA bouts are created by the ODDS pipeline, which groups them
// under a synthetic daily card ("Boxing — 26 Jul 2026") and slugs the bout
// `{red}-vs-{blue}`. Results only ever arrive from the Wikipedia provider, which
// goes through persistAggregated — and that slugs the bout
// `{eventName}-{red}-vs-{blue}`.
//
// Two different slugs for the same bout, and upsertFight keyed on slug alone. So a
// harvested result would land on a NEW row while every pick, battle and prediction
// stayed on the original — the result would be "written" (the job would report
// success) and nothing a reader can see would change.

/** The bout as the odds pipeline creates it: slug = `{red}-vs-{blue}`. */
async function oddsCreatedBout() {
  const [red, blue] = await Promise.all([
    prisma.fighter.create({ data: { slug: "errol-spence-jr", name: "Errol Spence Jr", sport: "BOXING" } }),
    prisma.fighter.create({ data: { slug: "tim-tszyu", name: "Tim Tszyu", sport: "BOXING" } }),
  ]);
  const event = await prisma.event.create({
    data: {
      slug: "boxing-2026-07-26",
      name: "Boxing — 26 Jul 2026",
      sport: "BOXING",
      promotion: "Various",
      date: new Date("2026-07-26T21:00:00Z"),
      status: "SCHEDULED",
    },
  });
  const fight = await prisma.fight.create({
    data: {
      slug: "errol-spence-jr-vs-tim-tszyu",
      eventId: event.id,
      redId: red.id,
      blueId: blue.id,
      date: event.date,
      scheduledRounds: 12,
    },
  });
  return { red, blue, event, fight };
}

/** The same bout as the Wikipedia provider reports it, with a result. */
const wikiResultFor = (eventName: string, date: Date): NormalizedEvent => ({
  externalId: "Errol Spence Jr. vs. Tim Tszyu",
  name: eventName,
  sport: "BOXING",
  date: date.toISOString(),
  status: "COMPLETED",
  fights: [
    {
      redName: "Errol Spence Jr",
      blueName: "Tim Tszyu",
      redExternalId: "errol-spence-jr",
      blueExternalId: "tim-tszyu",
      winnerExternalId: "errol-spence-jr",
      result: "WIN",
      method: "TKO",
      roundEnded: 9,
      mainEvent: true,
      scheduledRounds: 12,
    },
  ],
  _meta: { source: "wikipedia", confidence: 0.75, lastUpdated: new Date().toISOString(), externalId: "Errol Spence Jr. vs. Tim Tszyu" },
});

test("a wikicard result lands on the EXISTING odds-created bout, not a duplicate", async () => {
  const { event, fight } = await oddsCreatedBout();

  await persistAggregated("BOXING", "events", [wikiResultFor(event.name, event.date)]);

  const fights = await prisma.fight.findMany({ where: { eventId: event.id } });
  assert.equal(fights.length, 1, "the result must not create a second row for the same bout");
  assert.equal(fights[0].id, fight.id, "it must be the SAME row the picks hang off");
  assert.equal(fights[0].result, "WIN");
  assert.equal(fights[0].method, "TKO");
  assert.equal(fights[0].roundEnded, 9);
  assert.ok(fights[0].winnerId, "a decisive result must name a winner");
});

test("a result arriving for a bout with PICKS settles those picks, not an orphan's", async () => {
  // The whole point: the reader's prediction is on the odds-created row. If the
  // result lands elsewhere, settlement grades nothing and the prediction stays open
  // forever while the job reports written=1.
  const { event, fight } = await oddsCreatedBout();
  const user = await makeUser();
  await pick(user.id, fight.id, "RED", 4);

  await persistAggregated("BOXING", "events", [wikiResultFor(event.name, event.date)]);

  const graded = await prisma.fightPick.findUniqueOrThrow({
    where: { userId_fightId: { userId: user.id, fightId: fight.id } },
  });
  assert.equal(graded.correct, true, "the pick on the real bout must be graded");
  const u = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
  assert.equal(u.picksCorrect, 1);
  assert.ok(u.reputation > 0, "the payout must reach the reader who made the call");
});

test("corner ORDER does not create a duplicate — red/blue can be reported swapped", async () => {
  // Sources disagree about which fighter is "red". Identity is the pair, not the order.
  const { event, fight } = await oddsCreatedBout();
  const swapped = wikiResultFor(event.name, event.date);
  swapped.fights = [
    {
      ...swapped.fights![0],
      redName: "Tim Tszyu",
      blueName: "Errol Spence Jr",
      redExternalId: "tim-tszyu",
      blueExternalId: "errol-spence-jr",
      winnerExternalId: "errol-spence-jr",
    },
  ];

  await persistAggregated("BOXING", "events", [swapped]);

  const fights = await prisma.fight.findMany({ where: { eventId: event.id } });
  assert.equal(fights.length, 1, "a swapped-corner report is the same bout");
  assert.equal(fights[0].id, fight.id);
});
