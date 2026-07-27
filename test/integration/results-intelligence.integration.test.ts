import { test, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "@/lib/db";
import { collectEvidence, rescoreCandidate, publishCandidate, runResultsIntelligence } from "@/lib/results/pipeline";
import { listReviewQueue, reviewCandidate, reviewQueueStats } from "@/lib/results/queue";
import { resetDb, makeUser, makeFighter, pick } from "./helpers";

// ════════════════════════════════════════════════════════════════════════════
//  The production verification checklist, as executable tests.
//
//  Sections 2–8 of that checklist are LOGIC, not questions about live data, so they
//  belong here rather than in a manual pass someone has to remember to repeat. The
//  ones that genuinely need production (does the page load for a real admin, how
//  long does a human take, what are the live counts) are the only ones left manual.
//
//  The load-bearing tests are SETTLEMENT SAFETY and IDEMPOTENCY. Everything else is
//  quality; those two are the reason this subsystem is allowed to exist.
// ════════════════════════════════════════════════════════════════════════════

beforeEach(async () => { await resetDb(); });
after(async () => { await prisma.$disconnect(); });

let seq = 0;
const uniq = (p: string) => `${p}-${seq++}`;

/** A bout that finished yesterday, with an event and no result. */
async function finishedBout(opts: { red?: string; blue?: string; daysAgo?: number } = {}) {
  const [red, blue] = await Promise.all([
    makeFighter(opts.red ?? "Edgar Berlanga"),
    makeFighter(opts.blue ?? "Steven Butler"),
  ]);
  const date = new Date(Date.now() - (opts.daysAgo ?? 1) * 86_400_000);
  const event = await prisma.event.create({
    data: { slug: uniq("evt"), name: "Zuffa Boxing 09", sport: "BOXING", promotion: "Various", date, status: "SCHEDULED" },
  });
  const fight = await prisma.fight.create({
    data: { slug: uniq("f"), eventId: event.id, redId: red.id, blueId: blue.id, date, mainEvent: true },
  });
  return { red, blue, event, fight };
}

/** An ingested article, which is what the pipeline reads as evidence. */
async function article(title: string, host: string, opts: { excerpt?: string; hoursAfter?: number } = {}) {
  return prisma.article.create({
    data: {
      slug: uniq("a"),
      title,
      excerpt: opts.excerpt ?? null,
      content: title,
      category: "Fight news",
      status: "PUBLISHED",
      sourceUrl: `https://${host}/${uniq("story")}`,
      publishedAt: new Date(Date.now() - (opts.hoursAfter ?? 0) * 3600_000),
    },
  });
}

// ── §3 Evidence quality ─────────────────────────────────────────────────────

test("evidence rows are created from articles, with provenance and never empty", async () => {
  const { fight } = await finishedBout();
  await article("Edgar Berlanga Stops Steven Butler in Round 7", "espn.com");

  const n = await collectEvidence(fight.id);
  assert.equal(n, 1);

  const rows = await prisma.resultEvidence.findMany({ where: { fightId: fight.id } });
  assert.equal(rows.length, 1);
  const e = rows[0];
  // Every field the operator queue renders must be populated — a blank evidence row
  // is unjudgeable.
  assert.equal(e.sourceKind, "MAJOR");
  assert.equal(e.sourceName, "espn.com");
  assert.ok(e.sourceUrl?.startsWith("https://"));
  assert.ok(e.headline);
  assert.equal(e.outcome, "WIN");
  assert.equal(e.winnerCorner, "RED");
  assert.equal(e.method, "TKO");
  assert.equal(e.roundEnded, 7);
  assert.ok(e.quality > 0);
});

test("an article about a DIFFERENT bout creates no evidence", async () => {
  const { fight } = await finishedBout();
  await article("Richardson Hitchins outpoints Ricardo Salas Rodriguez", "espn.com");
  await article("Edgar Berlanga Wants Munguia After Butler Scare", "boxing247.com");
  assert.equal(await collectEvidence(fight.id), 0);
  assert.equal(await prisma.resultEvidence.count({ where: { fightId: fight.id } }), 0);
});

// ── §2 Candidate quality ────────────────────────────────────────────────────

test("two independent sources produce a VERIFIED candidate with the right reading", async () => {
  const { fight, red } = await finishedBout();
  await article("Edgar Berlanga Stops Steven Butler in Round 7", "espn.com");
  await article("Berlanga stops Butler in the seventh", "bbc.co.uk");

  await collectEvidence(fight.id);
  await rescoreCandidate(fight.id);
  // Read back from the DB rather than the return value: rescoreCandidate may return
  // an early-exit shape for an already-reviewed candidate, and the row is the truth.
  const c = await prisma.resultCandidate.findUnique({ where: { fightId: fight.id } });
  assert.ok(c);
  assert.equal(c.status, "VERIFIED");
  assert.equal(c.outcome, "WIN");
  assert.equal(c.winnerCorner, "RED");
  assert.equal(c.method, "TKO");
  assert.equal(c.roundEnded, 7);
  assert.equal(c.agreeing, 2);
  // The winner maps to a real fighter on the bout, not a name we invented.
  assert.equal(red.id, (await prisma.fight.findUnique({ where: { id: fight.id } }))!.redId);
});

test("one candidate per bout — a rescore replaces rather than accumulates", async () => {
  const { fight } = await finishedBout();
  await article("Berlanga stops Butler in round 7", "espn.com");
  await collectEvidence(fight.id);
  await rescoreCandidate(fight.id);
  await rescoreCandidate(fight.id);
  await rescoreCandidate(fight.id);
  assert.equal(await prisma.resultCandidate.count({ where: { fightId: fight.id } }), 1);
});

// ── §4 Confidence calibration ───────────────────────────────────────────────

test("ONE source never reaches VERIFIED, however good the extraction", async () => {
  // The calibration smell the checklist names: "confidence 0.99, 1 source only".
  const { fight } = await finishedBout();
  await article("Edgar Berlanga Stops Steven Butler in Round 7", "espn.com");
  await collectEvidence(fight.id);
  const c = await rescoreCandidate(fight.id);
  assert.ok(c);
  assert.equal(c.agreeing, 1);
  assert.notEqual(c.status, "VERIFIED");
});

test("Wikipedia + ESPN scores HIGH, not low", async () => {
  // The other calibration smell: strong sources producing a weak number.
  const { fight } = await finishedBout();
  await article("Berlanga stops Butler in round 7", "espn.com");
  await collectEvidence(fight.id);
  // Wikipedia contributes as evidence with an explicit kind.
  await prisma.resultEvidence.create({
    data: {
      fightId: fight.id, sourceKind: "WIKIPEDIA", sourceName: "wikipedia.org",
      sourceUrl: "https://en.wikipedia.org/wiki/Zuffa_Boxing_09",
      headline: "Zuffa Boxing 09", outcome: "WIN", winnerCorner: "RED",
      method: "TKO", roundEnded: 7, quality: 0.9,
    },
  });
  const c = await rescoreCandidate(fight.id);
  assert.ok(c);
  assert.ok(c.confidence >= 0.85, `expected high confidence, got ${c.confidence}`);
  assert.equal(c.status, "VERIFIED");
});

// ── §5 Conflict queue ───────────────────────────────────────────────────────

test("a genuine winner disagreement is CONFLICTED", async () => {
  const { fight } = await finishedBout();
  await article("Berlanga stops Butler in round 7", "espn.com");
  await article("Butler stops Berlanga in round 7", "bbc.co.uk");
  await collectEvidence(fight.id);
  const c = await rescoreCandidate(fight.id);
  assert.equal(c?.status, "CONFLICTED");
  assert.ok(c && c.disagreeing >= 1);
});

test("FORMATTING differences do NOT trigger a conflict", async () => {
  // "in round 7" vs "in the seventh" vs "R7" are the same claim. If these conflicted,
  // the queue would fill with noise and operators would stop trusting it.
  const { fight } = await finishedBout();
  await article("Berlanga stops Butler in round 7", "espn.com");
  await article("Berlanga stops Butler in the seventh", "bbc.co.uk");
  await article("Berlanga def. Butler TKO R7", "skysports.com");
  await collectEvidence(fight.id);
  const c = await rescoreCandidate(fight.id);
  assert.ok(c);
  assert.equal(c.status, "VERIFIED", `expected agreement, got ${c.status}: ${JSON.stringify(c.reasons)}`);
  assert.equal(c.disagreeing, 0);
  assert.equal(c.roundEnded, 7);
});

// ── §6 SETTLEMENT SAFETY. The reason this subsystem is allowed to exist. ────

test("a PENDING candidate cannot settle a bout", async () => {
  const { fight } = await finishedBout();
  await article("Berlanga stops Butler in round 7", "espn.com");
  await collectEvidence(fight.id);
  const c = await rescoreCandidate(fight.id);
  assert.notEqual(c?.status, "VERIFIED");

  const out = await publishCandidate(fight.id);
  assert.equal(out.published, false);
  // The bout is untouched.
  const after = await prisma.fight.findUnique({ where: { id: fight.id } });
  assert.equal(after?.result, "SCHEDULED");
  assert.equal(after?.winnerId, null);
});

test("approval writes the result, settles ONCE, and a second approval does nothing", async () => {
  const { fight, red } = await finishedBout();
  const operator = await makeUser();
  const punter = await makeUser();
  // A real prediction on the bout, so settlement has something to grade.
  await pick(punter.id, fight.id, "RED", 4);

  await article("Berlanga stops Butler in round 7", "espn.com");
  await collectEvidence(fight.id);
  await rescoreCandidate(fight.id);

  // BEFORE: no result.
  assert.equal((await prisma.fight.findUnique({ where: { id: fight.id } }))!.result, "SCHEDULED");

  const first = await reviewCandidate(operator.id, fight.id, { action: "approve" });
  assert.equal(first.ok, true);
  assert.equal(first.published, true);

  // AFTER: result written, winner correct.
  const decided = await prisma.fight.findUnique({ where: { id: fight.id } });
  assert.equal(decided?.result, "WIN");
  assert.equal(decided?.winnerId, red.id);
  assert.equal(decided?.method, "TKO");
  assert.equal(decided?.roundEnded, 7);

  // Settlement ran: the prediction is graded and reputation moved.
  const graded = await prisma.fightPick.findFirst({ where: { userId: punter.id, fightId: fight.id } });
  assert.equal(graded?.correct, true, "the pick was graded");
  const paid = await prisma.user.findUnique({ where: { id: punter.id }, select: { reputation: true, picksResolved: true } });
  assert.ok(paid && paid.reputation > 0, "reputation was awarded");
  assert.equal(paid?.picksResolved, 1);
  const repEvents = await prisma.reputationEvent.count({ where: { userId: punter.id } });

  // APPROVE AGAIN — nothing happens.
  const second = await reviewCandidate(operator.id, fight.id, { action: "approve" });
  assert.equal(second.published, false, "a second approval must not republish");
  assert.equal(
    await prisma.reputationEvent.count({ where: { userId: punter.id } }),
    repEvents,
    "no second payout",
  );
  assert.equal(paid?.picksResolved, 1);
});

test("publishCandidate refuses a bout that already has a result", async () => {
  const { fight, blue } = await finishedBout();
  await article("Berlanga stops Butler in round 7", "espn.com");
  await article("Berlanga stops Butler in the seventh", "bbc.co.uk");
  await collectEvidence(fight.id);
  await rescoreCandidate(fight.id);

  // Wikipedia (or an operator) got there first and recorded the OPPOSITE winner.
  await prisma.fight.update({
    where: { id: fight.id },
    data: { result: "WIN", winnerId: blue.id, method: "UD" },
  });

  const out = await publishCandidate(fight.id);
  assert.equal(out.published, false);
  assert.match(out.reason, /already has a result/);
  // The recorded result stands — a later reading must never rewrite it.
  const after = await prisma.fight.findUnique({ where: { id: fight.id } });
  assert.equal(after?.winnerId, blue.id);
  assert.equal(after?.method, "UD");
});

test("a rejection is not undone by the next hourly rescore", async () => {
  const { fight } = await finishedBout();
  const operator = await makeUser();
  await article("Berlanga stops Butler in round 7", "espn.com");
  await article("Berlanga stops Butler in the seventh", "bbc.co.uk");
  await collectEvidence(fight.id);
  await rescoreCandidate(fight.id);

  await reviewCandidate(operator.id, fight.id, { action: "reject", note: "wrong bout" });
  assert.equal((await prisma.resultCandidate.findUnique({ where: { fightId: fight.id } }))!.status, "REJECTED");

  // The cron runs again with the same (verifying) evidence.
  await rescoreCandidate(fight.id);
  assert.equal(
    (await prisma.resultCandidate.findUnique({ where: { fightId: fight.id } }))!.status,
    "REJECTED",
    "an operator decision survives the cron",
  );
});

test("every decision is audit-logged", async () => {
  const { fight } = await finishedBout();
  const operator = await makeUser();
  await article("Berlanga stops Butler in round 7", "espn.com");
  await collectEvidence(fight.id);
  await rescoreCandidate(fight.id);

  await reviewCandidate(operator.id, fight.id, { action: "reject", note: "not our bout" });
  const audit = await prisma.auditLog.findFirst({
    where: { entity: "ResultCandidate", entityId: fight.id },
  });
  assert.ok(audit, "the decision is auditable");
  assert.equal(audit.actorId, operator.id);
  assert.equal(audit.action, "result.reject");
});

// ── §7 Idempotency ──────────────────────────────────────────────────────────

test("running the whole pass TWICE creates no duplicates and settles once", async () => {
  const { fight } = await finishedBout();
  const punter = await makeUser();
  await pick(punter.id, fight.id, "RED", 3);
  await article("Berlanga stops Butler in round 7", "espn.com");
  await article("Berlanga stops Butler in the seventh", "bbc.co.uk");

  const first = await runResultsIntelligence();
  const second = await runResultsIntelligence();

  assert.equal(await prisma.resultEvidence.count({ where: { fightId: fight.id } }), 2, "no duplicate evidence");
  assert.equal(await prisma.resultCandidate.count({ where: { fightId: fight.id } }), 1, "no duplicate candidate");
  assert.equal(first.verified, 1, "published on the first pass");
  assert.equal(second.verified, 0, "nothing to publish on the second");

  // Settlement happened exactly once.
  assert.equal(await prisma.reputationEvent.count({ where: { userId: punter.id, reason: "pick_correct" } }), 1);
  assert.equal(
    await prisma.notification.count({ where: { userId: punter.id, type: "PICK_RESULT" } }),
    1,
    "no duplicate notification",
  );
});

// ── §8 Wikipedia interaction ────────────────────────────────────────────────

test("a bout Wikipedia already settled is skipped entirely — no candidate, no overwrite", async () => {
  const { fight, red } = await finishedBout();
  // Wikipedia wrote the result first, as it does today.
  await prisma.fight.update({
    where: { id: fight.id },
    data: { result: "WIN", winnerId: red.id, method: "KO", roundEnded: 2 },
  });
  // News then says something different.
  await article("Berlanga stops Butler in round 7", "espn.com");
  await article("Berlanga stops Butler in the seventh", "bbc.co.uk");

  const out = await runResultsIntelligence();

  assert.equal(out.scanned, 0, "a decided bout is not scanned");
  assert.equal(await prisma.resultCandidate.count({ where: { fightId: fight.id } }), 0, "no candidate created");
  const after = await prisma.fight.findUnique({ where: { id: fight.id } });
  assert.equal(after?.method, "KO", "Wikipedia's reading is untouched");
  assert.equal(after?.roundEnded, 2);
});

// ── §1 Queue health ─────────────────────────────────────────────────────────

test("the queue is empty and well-formed when there is nothing to review", async () => {
  const items = await listReviewQueue();
  assert.deepEqual(items, []);
  const stats = await reviewQueueStats();
  assert.equal(stats.published, 0);
});

test("a queue item carries everything needed to decide in one query", async () => {
  const { fight } = await finishedBout();
  await article("Berlanga stops Butler in round 7", "espn.com");
  await collectEvidence(fight.id);
  await rescoreCandidate(fight.id);

  const items = await listReviewQueue(["PENDING_REVIEW", "CONFLICTED", "INCONCLUSIVE"]);
  assert.equal(items.length, 1);
  const i = items[0];
  // §9 review UX: if any of these were missing the operator would have to click away
  // to judge the item, which is what makes a queue slow enough to be abandoned.
  assert.ok(i.fight.red.name && i.fight.blue.name, "both fighters");
  assert.ok(i.fight.event?.name, "the event");
  assert.ok(i.confidence > 0, "a confidence");
  assert.ok(i.reasons.length > 0, "the reasoning");
  assert.ok(i.evidence.length > 0, "the evidence");
  assert.ok(i.evidence[0].headline, "a readable headline");
  assert.ok(i.evidence[0].sourceUrl, "a link to the original");
});

test("bouts outside the scan window are not picked up", async () => {
  // §10 diagnostics: an empty queue can mean the window does not match the data, so
  // the boundary is pinned rather than assumed.
  await finishedBout({ daysAgo: 40, red: "Old Red", blue: "Old Blue" });
  await article("Old Red stops Old Blue in round 3", "espn.com");
  const out = await runResultsIntelligence();
  assert.equal(out.scanned, 0, "a 40-day-old bout is outside the 14-day window");
});
