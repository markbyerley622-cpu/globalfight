import { test, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "@/lib/db";
import { persistAggregated } from "@/services/sync/persist";
import type { NormalizedEvent } from "@/services/providers/types";
import { resetDb, makeFight } from "./helpers";

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
