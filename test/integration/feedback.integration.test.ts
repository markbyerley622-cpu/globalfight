import { test, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "@/lib/db";
import {
  createFeedback, voteFeedback, unvoteFeedback, listFeedback, getFeedback,
  setStatus, setHidden, myFeedback, feedbackStats,
} from "@/lib/feedback";
import { resetDb } from "./helpers";

// ════════════════════════════════════════════════════════════════════════════
//  The feedback board, against a real database.
//
//  The properties worth testing here are the ones no amount of reading the
//  source settles: does the unique constraint actually stop a double vote when
//  two requests arrive together, does a hidden item actually disappear from
//  every public read, and does the staff-only note actually stay out of the
//  public projection.
// ════════════════════════════════════════════════════════════════════════════

beforeEach(async () => { await resetDb(); });
after(async () => { await prisma.$disconnect(); });

const member = (n: string) =>
  prisma.user.create({ data: { username: `fb${n}`, email: `fb${n}@t.test`, registryRole: "fan" } });

const staff = (n: string) =>
  prisma.user.create({ data: { username: `fbstaff${n}`, email: `fbstaff${n}@t.test`, role: "ADMIN", registryRole: "fan" } });

async function anItem(authorId: string, title = "Make predictions easier to find") {
  const r = await createFeedback(authorId, { title, body: "It takes too many taps to reach the card.", category: "IMPROVEMENT" });
  assert.ok(r.ok, `expected the item to be created, got ${JSON.stringify(r)}`);
  return (r as { ok: true; id: string }).id;
}

test("a new item is always OPEN, whatever the submitter says", async () => {
  const u = await member("a");
  const id = await anItem(u.id);
  const row = await prisma.feedbackItem.findUniqueOrThrow({ where: { id } });
  assert.equal(row.status, "OPEN");
  assert.equal(row.authorId, u.id, "the author must be the session user");
  // There is no parameter on createFeedback that accepts a status, so a
  // submitter cannot publish "PLANNED" about their own request. This asserts
  // the resulting state rather than the absence of an argument.
});

test("validation: category, and both length bounds", async () => {
  const u = await member("b");
  assert.equal((await createFeedback(u.id, { title: "Valid title here", body: "Long enough body.", category: "NONSENSE" })).ok, false);
  assert.equal((await createFeedback(u.id, { title: "no", body: "Long enough body.", category: "IDEA" })).ok, false);
  assert.equal((await createFeedback(u.id, { title: "Valid title here", body: "short", category: "IDEA" })).ok, false);
  assert.equal((await createFeedback(u.id, { title: "x".repeat(200), body: "Long enough body.", category: "IDEA" })).ok, false);
});

test("moderation runs on submission — a slur is refused and nothing is written", async () => {
  const u = await member("c");
  const before = await prisma.feedbackItem.count();
  // The same pipeline the forums use. This asserts the board is WIRED to it,
  // not that the rules themselves work — those have their own tests.
  const r = await createFeedback(u.id, {
    title: "You are all a bunch of retards",
    body: "This place is garbage and so is everyone here.",
    category: "IDEA",
  });
  assert.equal(r.ok, false, "a slur was accepted onto a public board");
  assert.equal(await prisma.feedbackItem.count(), before, "a refused submission still wrote a row");
});

test("HTML in a submission is stored as text, never as markup", async () => {
  const u = await member("d");
  const payload = `<img src=x onerror="alert(1)">`;
  const r = await createFeedback(u.id, { title: `Bug ${payload}`, body: `Steps: ${payload}`, category: "BUG" });
  assert.ok(r.ok);
  const row = await prisma.feedbackItem.findUniqueOrThrow({ where: { id: (r as { ok: true; id: string }).id } });
  // Stored verbatim and rendered as a text node by React (no dangerouslySetInnerHTML
  // anywhere in the feedback components — the source guard asserts that).
  assert.ok(row.title.includes("<img"), "the payload was mangled rather than stored as text");
});

test("one member, one vote — and a repeat is a no-op, not an error", async () => {
  const author = await member("e1");
  const voter = await member("e2");
  const id = await anItem(author.id);

  const first = await voteFeedback(voter.id, id);
  assert.deepEqual(first, { ok: true, voted: true, count: 1 });

  const second = await voteFeedback(voter.id, id);
  assert.deepEqual(second, { ok: true, voted: true, count: 1 }, "a repeated vote changed the count");
  assert.equal(await prisma.feedbackVote.count({ where: { feedbackId: id } }), 1);
});

test("CONCURRENT votes from one account produce exactly one row", async () => {
  // The case a check-then-insert would lose: both requests see "no vote yet"
  // and both insert. The composite primary key makes that a database error and
  // createMany({skipDuplicates}) makes it a no-op instead of a 500.
  const author = await member("f1");
  const voter = await member("f2");
  const id = await anItem(author.id);

  const results = await Promise.all([
    voteFeedback(voter.id, id),
    voteFeedback(voter.id, id),
    voteFeedback(voter.id, id),
  ]);
  assert.ok(results.every((r) => r.ok), "a concurrent vote errored instead of being idempotent");
  assert.equal(
    await prisma.feedbackVote.count({ where: { feedbackId: id } }), 1,
    "concurrent votes from one account created more than one row",
  );
});

test("unvoting removes only your own vote, and is idempotent", async () => {
  const author = await member("g1");
  const a = await member("g2");
  const b = await member("g3");
  const id = await anItem(author.id);

  await voteFeedback(a.id, id);
  await voteFeedback(b.id, id);
  assert.equal((await unvoteFeedback(a.id, id)).ok, true);

  const left = await prisma.feedbackVote.findMany({ where: { feedbackId: id } });
  assert.equal(left.length, 1, "unvoting removed somebody else's vote");
  assert.equal(left[0].userId, b.id);

  // Again — deleting nothing is a success.
  assert.deepEqual(await unvoteFeedback(a.id, id), { ok: true, voted: false, count: 1 });
});

test("votes cannot be cast on a hidden item, and hidden items leave the board", async () => {
  const author = await member("h1");
  const voter = await member("h2");
  const admin = await staff("h");
  const id = await anItem(author.id);

  assert.equal((await setHidden(admin.id, id, true)).ok, true);

  const vote = await voteFeedback(voter.id, id);
  assert.equal(vote.ok, false, "a hidden item still accepted a vote");

  assert.equal(await getFeedback(id), null, "a hidden item is still readable");
  const board = await listFeedback({});
  assert.ok(!board.rows.some((r) => r.id === id), "a hidden item is still on the board");

  // The author still sees it, so they are not left wondering where it went.
  assert.ok((await myFeedback(author.id)).some((r) => r.id === id));
});

test("the public projection never carries the staff-only note", async () => {
  const author = await member("i");
  const admin = await staff("i");
  const id = await anItem(author.id);

  await setStatus(admin.id, id, "PLANNED", {
    publicNote: "On the roadmap for the autumn release.",
    adminNote: "INTERNAL: duplicate of the older one, keeping this for the votes.",
  });

  const serialised = JSON.stringify([await getFeedback(id), (await listFeedback({})).rows]);
  assert.ok(!serialised.includes("INTERNAL:"), "the staff note reached a public read");
  assert.ok(serialised.includes("autumn release"), "the public note is missing");
  // And no email anywhere in a public payload.
  assert.ok(!serialised.includes("@t.test"), "an author email reached a public read");
});

test("status transitions are audited, and the author is notified once", async () => {
  const author = await member("j");
  const admin = await staff("j");
  const id = await anItem(author.id);

  assert.equal((await setStatus(admin.id, id, "COMPLETED", { publicNote: "Shipped." })).ok, true);

  const row = await prisma.feedbackItem.findUniqueOrThrow({ where: { id } });
  assert.equal(row.status, "COMPLETED");
  assert.ok(row.resolvedAt, "COMPLETED did not stamp resolvedAt");
  assert.equal(row.resolvedById, admin.id, "the resolver must come from the session");

  const audit = await prisma.auditLog.findMany({ where: { entityId: id, action: "feedback.status" } });
  assert.equal(audit.length, 1);
  assert.equal(audit[0].actorId, admin.id);

  const notes = await prisma.notification.findMany({ where: { userId: author.id, type: "FEEDBACK_STATUS" } });
  assert.equal(notes.length, 1, "the author was not told, or was told twice");
});

test("an unknown status is refused", async () => {
  const author = await member("k");
  const admin = await staff("k");
  const id = await anItem(author.id);
  assert.deepEqual(await setStatus(admin.id, id, "SHIPPED_MAYBE"), { ok: false, error: "Unknown status." });
  assert.equal((await prisma.feedbackItem.findUniqueOrThrow({ where: { id } })).status, "OPEN");
});

test("the board sorts by real vote counts, from the database", async () => {
  const author = await member("l0");
  const quiet = await anItem(author.id, "A quiet idea nobody wanted");
  const loud = await anItem(author.id, "A loud idea everybody wanted");

  for (const n of ["l1", "l2", "l3"]) {
    const v = await member(n);
    await voteFeedback(v.id, loud);
  }
  const one = await member("l4");
  await voteFeedback(one.id, quiet);

  const top = await listFeedback({ sort: "top" });
  assert.equal(top.rows[0].id, loud, "the board is not ordered by votes");
  assert.equal(top.rows[0]._count.votes, 3);
});

test("viewerVoted is per-viewer and never changes which rows are returned", async () => {
  const author = await member("m1");
  const voter = await member("m2");
  const bystander = await member("m3");
  const id = await anItem(author.id);
  await voteFeedback(voter.id, id);

  const asVoter = await listFeedback({ viewerId: voter.id });
  const asBystander = await listFeedback({ viewerId: bystander.id });
  const asAnon = await listFeedback({});

  assert.equal(asVoter.rows.length, asBystander.rows.length);
  assert.equal(asAnon.rows.length, asVoter.rows.length, "anonymous sees a different board");
  assert.equal(asVoter.rows[0].viewerVoted, true);
  assert.equal(asBystander.rows[0].viewerVoted, false);
});

test("stats count only visible items", async () => {
  const author = await member("n");
  const admin = await staff("n");
  const a = await anItem(author.id, "First idea for the stats test");
  await anItem(author.id, "Second idea for the stats test");
  await setHidden(admin.id, a, true);

  const s = await feedbackStats();
  assert.equal(s.open, 1, "a hidden item is still being counted");
});
