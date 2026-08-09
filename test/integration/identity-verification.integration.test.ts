import { test, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "@/lib/db";
import { reviewVerification, myVerifications } from "@/lib/identity-verification";
import { resetDb } from "./helpers";

// ════════════════════════════════════════════════════════════════════════════
//  Identity verification, against a real database.
//
//  The source-level suite (src/lib/__tests__/identity-verification-security)
//  proves the STRUCTURAL properties — no other module writes the table, no
//  storage key reaches a response. Those cannot be checked at runtime, because
//  the risk they cover is the code path nobody thought to call.
//
//  These are the opposite half: the transactional guarantees, which no amount of
//  reading the source can settle. Does a decision actually roll back when it
//  loses a race? Does approval actually stamp the badge and write the audit row
//  together? Only a database answers that.
// ════════════════════════════════════════════════════════════════════════════

beforeEach(async () => { await resetDb(); });
after(async () => { await prisma.$disconnect(); });

async function applicant(suffix: string) {
  const user = await prisma.user.create({
    data: {
      username: `applicant${suffix}`,
      email: `applicant${suffix}@t.test`,
      registryRole: "coach",
    },
  });
  const v = await prisma.identityVerification.create({
    data: { userId: user.id, role: "coach", status: "PENDING", attempt: 1 },
  });
  return { user, v };
}

async function reviewer(suffix: string) {
  return prisma.user.create({
    data: { username: `staff${suffix}`, email: `staff${suffix}@t.test`, role: "ADMIN", registryRole: "fan" },
  });
}

test("approval stamps the badge, the reviewer, the timestamp and an audit row together", async () => {
  const { user, v } = await applicant("a");
  const staff = await reviewer("a");

  const res = await reviewVerification(v.id, staff.id, "APPROVE");
  assert.deepEqual(res, { ok: true });

  const after = await prisma.identityVerification.findUniqueOrThrow({ where: { id: v.id } });
  assert.equal(after.status, "APPROVED");
  assert.equal(after.reviewerId, staff.id, "the reviewer must come from the session, not the request");
  assert.ok(after.reviewedAt, "no review timestamp was written");

  const subject = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
  assert.ok(subject.professionalVerifiedAt, "the badge column was not stamped");

  const audit = await prisma.auditLog.findMany({ where: { entityId: v.id } });
  assert.equal(audit.length, 1, "an approval must leave exactly one audit row");
  assert.equal(audit[0].actorId, staff.id);
});

test("a decline requires a reason, and refuses without one", async () => {
  const { v } = await applicant("b");
  const staff = await reviewer("b");

  assert.deepEqual(
    await reviewVerification(v.id, staff.id, "DECLINE", { reason: "   " }),
    { ok: false, reason: "REASON_REQUIRED" },
    "a whitespace-only reason must not count — the user sees this text",
  );

  const untouched = await prisma.identityVerification.findUniqueOrThrow({ where: { id: v.id } });
  assert.equal(untouched.status, "PENDING", "a refused decision must not have written anything");
  assert.equal(await prisma.auditLog.count({ where: { entityId: v.id } }), 0);
});

test("CONCURRENT decisions: exactly one wins, and the loser writes nothing", async () => {
  // ── The race this closes ────────────────────────────────────────────────
  // reviewVerification used to read the status, check isOpen(), then update.
  // Two reviewers with the same queue open is the ordinary case, so both could
  // pass the read and both write — two audit rows for one decision, and an
  // APPROVE landing after a DECLINE would still leave professionalVerifiedAt
  // set. A rejected applicant would wear a verified badge.
  const { user, v } = await applicant("c");
  const one = await reviewer("c1");
  const two = await reviewer("c2");

  const [a, b] = await Promise.all([
    reviewVerification(v.id, one.id, "APPROVE"),
    reviewVerification(v.id, two.id, "DECLINE", { reason: "Document unreadable." }),
  ]);

  const winners = [a, b].filter((r) => r.ok);
  const losers = [a, b].filter((r) => !r.ok);
  assert.equal(winners.length, 1, `exactly one decision must succeed, got ${winners.length}`);
  assert.equal(losers.length, 1);
  assert.equal((losers[0] as { reason: string }).reason, "NOT_OPEN");

  // One decision means one audit row. Two would mean both transactions ran.
  assert.equal(
    await prisma.auditLog.count({ where: { entityId: v.id } }), 1,
    "the losing reviewer left an audit row — its transaction was not rolled back",
  );

  // And the badge must agree with whichever decision actually won.
  const row = await prisma.identityVerification.findUniqueOrThrow({ where: { id: v.id } });
  const subject = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
  if (row.status === "APPROVED") {
    assert.ok(subject.professionalVerifiedAt, "approved, but no badge");
  } else {
    assert.equal(
      subject.professionalVerifiedAt, null,
      "DECLINED, but the badge is set — the losing APPROVE leaked its user update",
    );
  }
});

test("a decided request cannot be decided again", async () => {
  const { v } = await applicant("d");
  const staff = await reviewer("d");

  assert.deepEqual(await reviewVerification(v.id, staff.id, "APPROVE"), { ok: true });
  assert.deepEqual(
    await reviewVerification(v.id, staff.id, "DECLINE", { reason: "changed my mind" }),
    { ok: false, reason: "NOT_OPEN" },
    "a replayed decision must be refused — this is the replay case for the decide endpoint",
  );
  assert.equal(await prisma.auditLog.count({ where: { entityId: v.id } }), 1);
});

test("IDOR: one applicant's history never contains another's request", async () => {
  const a = await applicant("e1");
  const b = await applicant("e2");

  const mine = await myVerifications(a.user.id);
  assert.equal(mine.length, 1);
  assert.equal(mine[0].id, a.v.id);
  assert.ok(
    !mine.some((r) => r.id === b.v.id),
    "user A's history contains user B's verification",
  );
});

test("the user's own history exposes no storage key and no staff note", async () => {
  const { user, v } = await applicant("f");
  const staff = await reviewer("f");
  await prisma.identityDocument.create({
    data: {
      verificationId: v.id, kind: "FRONT",
      storageKey: "private/verification/secret-object-key",
      storageProvider: "r2", contentType: "image/jpeg", byteSize: 1234, scanStatus: "CLEAN",
    },
  });
  await reviewVerification(v.id, staff.id, "DECLINE", {
    reason: "Please resend the front, it is blurred.",
    note: "INTERNAL: possible duplicate of another applicant",
  });

  const serialised = JSON.stringify(await myVerifications(user.id));
  assert.ok(!serialised.includes("secret-object-key"), "a storage key reached the user's own history");
  assert.ok(!serialised.includes("INTERNAL:"), "the staff-only review note reached the user");
  assert.ok(
    serialised.includes("Please resend the front"),
    "the user-facing decline reason is missing — they cannot act on it",
  );
});
