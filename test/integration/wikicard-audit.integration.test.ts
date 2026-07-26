import { test, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "@/lib/db";
import { auditEventBySlug, auditWikicards, verdictFor, NORMAL_MAX, REVIEW_MAX } from "@/lib/scraper/wikicard/audit";
import { resetDb, makeUser, pick } from "./helpers";

// ════════════════════════════════════════════════════════════════════════════
//  Production data-integrity audit, against a real database.
//
//  The situation being modelled: a repair attached a Wikipedia SEASON page — every
//  card of the year — to one event. Future writes are fixed; these tests pin that the
//  audit can find the damage afterwards and that the cleanup rules never take a bout
//  anything depends on.
//
//  The hardest constraint is that Fight had NO provenance before FightImport, so
//  historical damage has to be identified structurally. Both paths are covered:
//  with recorded provenance, and without it.
// ════════════════════════════════════════════════════════════════════════════

beforeEach(async () => { await resetDb(); });
after(async () => { await prisma.$disconnect(); });

const DAYS_AGO = (n: number) => new Date(Date.now() - n * 86_400_000);

let seq = 0;
const uniq = (p: string) => `${p}-${seq++}`;

async function fighter(name: string) {
  return prisma.fighter.create({ data: { slug: uniq(name.toLowerCase().replace(/\s+/g, "-")), name, sport: "BARE_KNUCKLE" } });
}

/** An event with `real` genuine bouts, plus `attached` bouts from other cards. */
async function contaminatedEvent(opts: { real: number; attached: number; withProvenance?: boolean }) {
  const date = DAYS_AGO(3);
  const event = await prisma.event.create({
    data: { slug: "bkfc-91", name: "BKFC 91", sport: "BARE_KNUCKLE", promotion: "BKFC", date, status: "SCHEDULED" },
  });

  // Genuine bouts, as the promotion's own scraper created them: slug is NOT prefixed
  // with the event name.
  const real = [];
  for (let i = 0; i < opts.real; i++) {
    const [r, b] = await Promise.all([fighter(`Real Red ${i}`), fighter(`Real Blue ${i}`)]);
    real.push(await prisma.fight.create({
      data: { slug: `real-red-${i}-vs-real-blue-${i}`, eventId: event.id, redId: r.id, blueId: b.id, date },
    }));
  }

  // Bouts the bad import attached: slug IS prefixed with the event name, which is how
  // persistAggregated slugs what it creates.
  const attached = [];
  for (let i = 0; i < opts.attached; i++) {
    const [r, b] = await Promise.all([fighter(`Other Red ${i}`), fighter(`Other Blue ${i}`)]);
    const f = await prisma.fight.create({
      data: { slug: `bkfc-91-other-red-${i}-vs-other-blue-${i}`, eventId: event.id, redId: r.id, blueId: b.id, date },
    });
    if (opts.withProvenance) {
      await prisma.fightImport.create({
        data: { fightId: f.id, source: "wikipedia", sourceRef: "2026 in Bare Knuckle Fighting Championship", created: true },
      });
    }
    attached.push(f);
  }
  return { event, real, attached };
}

// ── bands ───────────────────────────────────────────────────────────────────

test("verdict bands are measured, not guessed", () => {
  assert.equal(verdictFor(11), "normal", "a normal BKFC card");
  assert.equal(verdictFor(NORMAL_MAX), "normal");
  assert.equal(verdictFor(NORMAL_MAX + 1), "review");
  assert.equal(verdictFor(REVIEW_MAX), "review");
  assert.equal(verdictFor(REVIEW_MAX + 1), "contaminated");
  assert.equal(verdictFor(190), "contaminated", "the shape of the real incident");
});

// ── detection ───────────────────────────────────────────────────────────────

test("a season-page over-attach is flagged CONTAMINATED and its bouts identified", async () => {
  const { event, real, attached } = await contaminatedEvent({ real: 11, attached: 40, withProvenance: true });

  const a = await auditEventBySlug(event.slug);
  assert.ok(a);
  assert.equal(a!.boutCount, 51);
  assert.equal(a!.verdict, "contaminated");
  assert.equal(a!.suspectCount, attached.length, "every attached bout is suspect");
  assert.deepEqual(a!.wikiRefs, ["2026 in Bare Knuckle Fighting Championship"]);

  // The genuine card is untouched by the verdict.
  const keptIds = a!.bouts.filter((b) => !b.suspect).map((b) => b.id).sort();
  assert.deepEqual(keptIds, real.map((f) => f.id).sort());
});

test("damage written BEFORE provenance existed is still detectable, on slug shape", async () => {
  // FightImport did not exist when the bad run happened, so the audit has to work
  // with nothing but the slug the aggregated pipeline left behind.
  const { event, real } = await contaminatedEvent({ real: 11, attached: 40, withProvenance: false });

  const a = await auditEventBySlug(event.slug);
  assert.equal(a!.verdict, "contaminated");
  assert.equal(a!.suspectCount, 40);
  assert.equal(a!.wikiRefs.length, 0, "and it reports honestly that it has no provenance");
  for (const b of a!.bouts.filter((x) => x.suspect)) {
    assert.equal(b.source, null);
    assert.equal(b.namePrefixedSlug, true, "identified structurally");
  }
  assert.equal(a!.bouts.filter((b) => !b.suspect).length, real.length);
});

test("a healthy card is never flagged", async () => {
  await contaminatedEvent({ real: 12, attached: 0 });
  assert.equal((await auditWikicards()).length, 0, "12 bouts is a normal card");
});

test("auditWikicards finds the damaged events without being told which", async () => {
  await contaminatedEvent({ real: 11, attached: 40, withProvenance: true });
  const found = await auditWikicards();
  assert.equal(found.length, 1);
  assert.equal(found[0].slug, "bkfc-91");
});

// ── the safety rules ────────────────────────────────────────────────────────

test("a bout carrying a PICK is never suspect, however it was written", async () => {
  const { attached } = await contaminatedEvent({ real: 11, attached: 5, withProvenance: true });
  const user = await makeUser();
  await pick(user.id, attached[0].id, "RED");

  const a = await auditEventBySlug("bkfc-91");
  const picked = a!.bouts.find((b) => b.id === attached[0].id)!;
  assert.equal(picked.suspect, false, "user data outranks every other signal");
  assert.match(picked.keepReason!, /^referenced/);
  assert.equal(a!.protectedCount, 1);
  assert.equal(a!.suspectCount, 4, "the other four remain removable");
});

test("a bout carrying a BATTLE is never suspect", async () => {
  const { attached } = await contaminatedEvent({ real: 11, attached: 3, withProvenance: true });
  const [a1, b1] = await Promise.all([makeUser(), makeUser()]);
  await prisma.battle.create({
    data: {
      fightId: attached[0].id, challengerId: a1.id, challengerCorner: "RED",
      opponentId: b1.id, opponentCorner: "BLUE", state: "ACTIVE",
    },
  });
  const a = await auditEventBySlug("bkfc-91");
  assert.equal(a!.bouts.find((b) => b.id === attached[0].id)!.suspect, false);
  assert.equal(a!.suspectCount, 2);
});

test("a bout carrying ODDS is never suspect — it came from the market, not a page", async () => {
  const { attached } = await contaminatedEvent({ real: 11, attached: 3, withProvenance: true });
  await prisma.oddsSnapshot.create({
    data: { fightId: attached[0].id, bookmaker: "test", redOdds: 1.5, blueOdds: 2.5, redImplied: 0.6, blueImplied: 0.4 },
  });
  const a = await auditEventBySlug("bkfc-91");
  assert.equal(a!.bouts.find((b) => b.id === attached[0].id)!.suspect, false);
});

test("an OFFICIAL RESULT on a genuine bout survives — it is never a candidate", async () => {
  const { real } = await contaminatedEvent({ real: 11, attached: 20, withProvenance: true });
  await prisma.fight.update({
    where: { id: real[0].id },
    data: { result: "WIN", winnerId: real[0].redId, method: "KO", roundEnded: 2 },
  });
  const a = await auditEventBySlug("bkfc-91");
  const decided = a!.bouts.find((b) => b.id === real[0].id)!;
  assert.equal(decided.suspect, false);
  assert.equal(decided.result, "WIN");
});

test("provenance from ANOTHER source protects a bout", async () => {
  // A bout the BKFC scraper created is not the Wikipedia repair's to remove.
  const { attached } = await contaminatedEvent({ real: 11, attached: 3, withProvenance: true });
  await prisma.fightImport.update({
    where: { fightId_source: { fightId: attached[0].id, source: "wikipedia" } },
    data: { source: "bkfc" },
  }).catch(async () => {
    await prisma.fightImport.deleteMany({ where: { fightId: attached[0].id } });
    await prisma.fightImport.create({ data: { fightId: attached[0].id, source: "bkfc", created: true } });
  });
  const a = await auditEventBySlug("bkfc-91");
  const other = a!.bouts.find((b) => b.id === attached[0].id)!;
  assert.equal(other.suspect, false);
  assert.match(other.keepReason!, /provenance says bkfc/);
});

test("an import that only UPDATED a bout may not remove it", async () => {
  const { attached } = await contaminatedEvent({ real: 11, attached: 2, withProvenance: false });
  await prisma.fightImport.create({
    data: { fightId: attached[0].id, source: "wikipedia", sourceRef: "Some Page", created: false },
  });
  const a = await auditEventBySlug("bkfc-91");
  const updated = a!.bouts.find((b) => b.id === attached[0].id)!;
  assert.equal(updated.suspect, false, "it predates the import; the import only touched it");
  assert.match(updated.keepReason!, /updated, not created/);
});

// ── windowing ───────────────────────────────────────────────────────────────

test("--since scopes the audit to a known bad run and spares everything older", async () => {
  const { event } = await contaminatedEvent({ real: 11, attached: 20, withProvenance: true });
  // Everything above was created just now; a window starting in the future spares all.
  const future = new Date(Date.now() + 60_000);
  const a = await auditEventBySlug(event.slug, { since: future });
  assert.equal(a!.suspectCount, 0, "nothing was created inside the window");
  for (const b of a!.bouts) {
    if (b.keepReason) assert.match(b.keepReason, /before the audited window|referenced|slug is not/);
  }
});
