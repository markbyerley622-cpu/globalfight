// Live smoke test for identity verification — `npm run identity:smoke`.
//
// Exercises the transactional and security-relevant behaviour that unit tests
// cannot: real uploads through the private store, EXIF stripping, the one-open-
// request rule, the approve/decline transitions, the audit trail, retention,
// and the delete cascade.
//
// Refuses to run against a non-local database — it writes User rows and stores
// objects.
import sharp from "sharp";
import { prisma } from "@/lib/db";
import {
  submitVerification, reviewVerification, canSubmit, myVerifications,
  listVerifications, verificationStats, cleanupExpiredIdentityDocuments,
  isProfessionalRole, DOCUMENT_RETENTION_DAYS,
} from "@/lib/identity-verification";
import { getEvidenceBytes, deleteEvidence } from "@/lib/evidence/store";

const url = process.env.DATABASE_URL ?? "";
const host = (() => { try { return new URL(url).hostname; } catch { return ""; } })();
if (!["localhost", "127.0.0.1", "::1"].includes(host)) {
  console.error(`Refusing to run: DATABASE_URL points at "${host || "(unparseable)"}", not a local database.`);
  process.exit(2);
}

/**
 * Every object this script stores, recorded the moment it is created.
 *
 * Cleaning up by QUERYING for the rows does not work: the cascade test deletes
 * the user, which cascades the IdentityDocument rows away, and the bytes are
 * then unreachable — there is nothing left pointing at them. Retention walks
 * that same table, so it cannot find them either. The keys have to be captured
 * while the rows still exist.
 */
const storedKeys: { storageKey: string; storageProvider: string }[] = [];
async function recordKeys(verificationId: string) {
  storedKeys.push(...await prisma.identityDocument.findMany({
    where: { verificationId },
    select: { storageKey: true, storageProvider: true },
  }));
}

let pass = 0, fail = 0;
const check = (name: string, ok: boolean, extra = "") => {
  if (ok) { pass++; console.log(`  PASS  ${name}`); }
  else { fail++; console.log(`  FAIL  ${name} ${extra}`); }
};

/** A real JPEG carrying GPS EXIF — the thing we must not store. */
async function idPhotoWithGps(): Promise<Buffer> {
  return sharp({ create: { width: 400, height: 250, channels: 3, background: { r: 30, g: 40, b: 60 } } })
    .withExifMerge({ IFD0: { Copyright: "SMOKE-TEST" }, GPS: { GPSLatitudeRef: "N", GPSLongitudeRef: "W" } })
    .jpeg()
    .toBuffer();
}

const stamp = Date.now();
const mk = (role: string, n: number) => prisma.user.create({
  data: {
    email: `_smoke_idv${n}_${stamp}@example.test`, name: `IDV ${n}`,
    username: `smokeidv${n}${stamp}`, passwordHash: "x", registryRole: role,
  },
  select: { id: true },
});

const admin = await mk("fan", 0);
await prisma.user.update({ where: { id: admin.id }, data: { role: "ADMIN" } });

try {
  // ── 1. role eligibility ───────────────────────────────────────────────────
  check("fan is not a professional role", !isProfessionalRole("fan"));
  check("coach is a professional role", isProfessionalRole("coach"));
  check("an unknown role is not professional", !isProfessionalRole("wizard"));

  const fan = await mk("fan", 1);
  const fanCan = await canSubmit(fan.id);
  check("a fan cannot submit", !fanCan.allowed);

  // ── 2. submit ─────────────────────────────────────────────────────────────
  const coach = await mk("coach", 2);
  const original = await idPhotoWithGps();
  check("fixture really carries EXIF", (await sharp(original).metadata()).exif !== undefined);

  const sub = await submitVerification(coach.id, [
    { kind: "FRONT", bytes: original, declaredMime: "image/jpeg" },
    { kind: "BACK", bytes: await idPhotoWithGps(), declaredMime: "image/jpeg" },
  ]);
  check("coach submission accepted", sub.ok, JSON.stringify(sub));
  if (!sub.ok) throw new Error("cannot continue");
  await recordKeys(sub.verificationId);
  check("first submission is attempt 1", sub.attempt === 1);

  // ── 3. the stored bytes must be clean ─────────────────────────────────────
  const docs = await prisma.identityDocument.findMany({
    where: { verificationId: sub.verificationId },
    select: { id: true, kind: true, storageKey: true, storageProvider: true, deleteAfter: true },
  });
  check("both documents stored", docs.length === 2, String(docs.length));
  const front = docs.find((d) => d.kind === "FRONT")!;
  const storedBytes = await getEvidenceBytes(front.storageKey, front.storageProvider);
  check("stored object is readable", Boolean(storedBytes));
  const meta = await sharp(storedBytes!.body).metadata();
  check("EXIF/GPS stripped from the STORED bytes", meta.exif === undefined,
    meta.exif ? "exif still present" : "");
  check("retention deadline set", front.deleteAfter !== null);

  // ── 4. no key ever leaks to the user-facing shape ─────────────────────────
  const mine = await myVerifications(coach.id);
  const serialised = JSON.stringify(mine);
  check("user-facing history has no storage key", !serialised.includes(front.storageKey));
  check("user-facing history has no reviewNote field", !serialised.includes("reviewNote"));

  // ── 5. one open request at a time ─────────────────────────────────────────
  const dup = await submitVerification(coach.id, [{ kind: "FRONT", bytes: original, declaredMime: "image/jpeg" }]);
  check("second submission blocked while one is pending", !dup.ok && dup.reason === "ALREADY_PENDING");

  // ── 6. rejects bad input ──────────────────────────────────────────────────
  const promoter = await mk("promoter", 3);
  const notAnImage = Buffer.from("%PDF-1.4 this is not an image", "utf8");
  const bad = await submitVerification(promoter.id, [{ kind: "FRONT", bytes: notAnImage, declaredMime: "image/jpeg" }]);
  check("a non-image is refused", !bad.ok && bad.reason === "BAD_FILE", JSON.stringify(bad));
  const none = await submitVerification(promoter.id, []);
  check("an empty submission is refused", !none.ok && none.reason === "NO_DOCUMENTS");

  // ── 7. decline requires a reason, and is user-visible ─────────────────────
  const noReason = await reviewVerification(sub.verificationId, admin.id, "DECLINE", {});
  check("decline without a reason is refused", !noReason.ok && noReason.reason === "REASON_REQUIRED");

  const declined = await reviewVerification(sub.verificationId, admin.id, "DECLINE", {
    reason: "The back of the ID is unreadable.", note: "internal-only note",
  });
  check("decline recorded", declined.ok);
  const after = await prisma.identityVerification.findUnique({
    where: { id: sub.verificationId },
    select: { status: true, reviewerId: true, reviewedAt: true, declineReason: true, reviewNote: true },
  });
  check("status is DECLINED", after?.status === "DECLINED");
  check("reviewer recorded", after?.reviewerId === admin.id);
  check("reason stored", after?.declineReason?.includes("unreadable") === true);
  check("internal note stored separately", after?.reviewNote === "internal-only note");

  const coachAfter = await prisma.user.findUnique({ where: { id: coach.id }, select: { professionalVerifiedAt: true } });
  check("a decline does NOT verify the user", coachAfter?.professionalVerifiedAt === null);

  // ── 8. a decided request cannot be re-decided ─────────────────────────────
  const again = await reviewVerification(sub.verificationId, admin.id, "APPROVE", {});
  check("a decided request cannot be re-decided", !again.ok && again.reason === "NOT_OPEN");

  // ── 9. resubmission works and increments the attempt ──────────────────────
  const can2 = await canSubmit(coach.id);
  check("can resubmit after a decline", can2.allowed, can2.reason ?? "");
  const sub2 = await submitVerification(coach.id, [{ kind: "FRONT", bytes: original, declaredMime: "image/jpeg" }]);
  check("resubmission accepted", sub2.ok);
  check("attempt incremented to 2", sub2.ok && sub2.attempt === 2, sub2.ok ? String(sub2.attempt) : "");
  if (sub2.ok) await recordKeys(sub2.verificationId);

  // ── 10. approval verifies the user, in one transaction ────────────────────
  if (sub2.ok) {
    const approved = await reviewVerification(sub2.verificationId, admin.id, "APPROVE", { note: "looks good" });
    check("approval recorded", approved.ok);
    const u = await prisma.user.findUnique({ where: { id: coach.id }, select: { professionalVerifiedAt: true } });
    check("User.professionalVerifiedAt set by approval", u?.professionalVerifiedAt !== null);
    const can3 = await canSubmit(coach.id);
    check("a verified user cannot submit again", !can3.allowed);
  }

  // ── 11. audit trail ───────────────────────────────────────────────────────
  const audits = await prisma.auditLog.findMany({
    where: { entity: "IdentityVerification", entityId: { in: [sub.verificationId, sub2.ok ? sub2.verificationId : ""] } },
    select: { action: true, actorId: true, meta: true },
  });
  check("submit + decline + approve all audited", audits.length >= 4, String(audits.length));
  const declineAudit = audits.find((a) => a.action === "identity.decline");
  const m = declineAudit?.meta as Record<string, unknown> | null;
  check("audit records the status transition", m?.previousStatus === "PENDING" && m?.newStatus === "DECLINED",
    JSON.stringify(m));

  // ── 12. admin queue + stats ───────────────────────────────────────────────
  const queue = await listVerifications({ q: "IDV 2" });
  check("queue finds the user by name", queue.rows.length >= 1, String(queue.rows.length));
  const queueJson = JSON.stringify(queue);
  check("queue payload carries no storage key", !queueJson.includes(front.storageKey));
  const stats = await verificationStats();
  check("stats compute without error", typeof stats.pending === "number");

  // ── 13. retention deletes bytes but keeps the decision ────────────────────
  await prisma.identityDocument.updateMany({
    where: { verificationId: sub.verificationId },
    data: { deleteAfter: new Date(Date.now() - 1000) },
  });
  const swept = await cleanupExpiredIdentityDocuments();
  check("retention deleted the expired documents", swept.deleted + swept.alreadyGone >= 2,
    JSON.stringify(swept));
  const gone = await getEvidenceBytes(front.storageKey, front.storageProvider).catch(() => null);
  check("bytes are actually gone from the store", !gone);
  const decisionSurvives = await prisma.identityVerification.findUnique({ where: { id: sub.verificationId } });
  check("the DECISION row survives retention", decisionSurvives !== null);
  check(`retention window is ${DOCUMENT_RETENTION_DAYS} days`, DOCUMENT_RETENTION_DAYS === 30);

  // ── 14. cascade ───────────────────────────────────────────────────────────
  await prisma.user.delete({ where: { id: coach.id } });
  const orphanV = await prisma.identityVerification.count({ where: { userId: coach.id } });
  const orphanD = await prisma.identityDocument.count({ where: { verificationId: sub.verificationId } });
  check("verifications cascade-delete with the user", orphanV === 0);
  check("documents cascade-delete with the verification", orphanD === 0);
} finally {
  // Delete the STORED OBJECTS before the rows that point at them.
  //
  // The cascade removes IdentityDocument rows, which is exactly what makes the
  // bytes unreachable — retention walks that table, so a cascade-first cleanup
  // orphans every object it was supposed to delete. The approved run is the one
  // that bites: it is never retention-swept, so its image survived the first
  // version of this script and landed in a commit.
  for (const d of storedKeys) await deleteEvidence(d.storageKey, d.storageProvider).catch(() => {});
  if (storedKeys.length) console.log(`\n  cleaned up ${storedKeys.length} stored object(s)`);

  await prisma.user.deleteMany({ where: { email: { startsWith: "_smoke_idv" } } });
  await prisma.$disconnect();
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
