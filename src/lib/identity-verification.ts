// ════════════════════════════════════════════════════════════════════════
//  Manual identity verification for professional registry roles.
//
//  POST-SIGNUP, never a gate. The account exists and works from the moment of
//  registration; this decides only the verified badge and professional
//  privileges. That ordering is the whole design: a human review queue in front
//  of registration abandons every signup that arrives while the queue is asleep.
//
//  Storage is NOT reimplemented here. `lib/evidence/*` already solves the hard
//  part for claim documents — magic-byte MIME sniffing, polyglot detection,
//  EXIF stripping, private-bucket enforcement, virus scanning, retention
//  deletion — and identity documents are the same class of object with the same
//  threat model. A second uploader would be a second set of those decisions to
//  keep in sync, and the one that drifts is the one that leaks.
// ════════════════════════════════════════════════════════════════════════

import "server-only";
import { prisma } from "@/lib/db";
import { notify } from "@/lib/notifications-store";
import {
  isProfessionalRole, roleLabel, isOpen,
  type VerificationStatus, type DocumentKind,
} from "@/lib/identity-verification-shared";
import {
  putEvidence, validateEvidence, deleteEvidence, stripMetadata,
  MAX_EVIDENCE_BYTES, type AcceptedMime,
} from "@/lib/evidence/store";
import { scanBytes } from "@/lib/evidence/scan";
import { daysFromNow } from "@/lib/evidence/lifecycle";

/** How long an identity document is kept after the decision that needed it. */
export const DOCUMENT_RETENTION_DAYS = 30;

/**
 * Identity documents are IMAGES ONLY.
 *
 * The shared store also accepts `application/pdf`, which is right for a claim's
 * proof-of-employment letter and wrong here: a PDF is a container that can
 * carry script and embedded files, and unlike an image there is nothing to
 * flatten it to. Narrowing at this boundary reuses the validator without
 * loosening it for anyone else.
 */
export const IDENTITY_MIME: readonly AcceptedMime[] = ["image/jpeg", "image/png", "image/webp"];

export { MAX_EVIDENCE_BYTES };

// The role predicates and the status/kind unions live in the client-safe half
// so the account banner can use them without dragging Prisma into the browser.
export {
  isProfessionalRole, roleLabel, isOpen,
  type VerificationStatus, type DocumentKind,
} from "@/lib/identity-verification-shared";

export interface UploadInput {
  kind: DocumentKind;
  bytes: Buffer;
  declaredMime: string;
}

export type SubmitResult =
  | { ok: true; verificationId: string; attempt: number }
  | { ok: false; reason: "NOT_PROFESSIONAL" | "ALREADY_PENDING" | "ALREADY_VERIFIED" | "NO_DOCUMENTS" | "BAD_FILE"; detail?: string };

/**
 * Accept a set of documents and open a review request.
 *
 * Every byte is validated, stripped and scanned BEFORE any row is written, and
 * the rows are written in one transaction. The failure mode being designed
 * against is a half-submitted request: a verification row pointing at objects
 * that were never stored, or stored objects with nothing referencing them (which
 * retention would then never find, because retention walks the table).
 */
export async function submitVerification(userId: string, uploads: UploadInput[]): Promise<SubmitResult> {
  if (uploads.length === 0) return { ok: false, reason: "NO_DOCUMENTS" };

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { registryRole: true, professionalVerifiedAt: true },
  });
  if (!user) return { ok: false, reason: "NOT_PROFESSIONAL" };
  if (!isProfessionalRole(user.registryRole)) return { ok: false, reason: "NOT_PROFESSIONAL" };
  if (user.professionalVerifiedAt) return { ok: false, reason: "ALREADY_VERIFIED" };

  const open = await prisma.identityVerification.findFirst({
    where: { userId, status: "PENDING" },
    select: { id: true },
  });
  if (open) return { ok: false, reason: "ALREADY_PENDING" };

  // Validate everything first — a rejected third file must not leave the first
  // two sitting in the bucket unreferenced.
  for (const u of uploads) {
    if (u.bytes.byteLength > MAX_EVIDENCE_BYTES) {
      return { ok: false, reason: "BAD_FILE", detail: `${u.kind} is larger than ${Math.floor(MAX_EVIDENCE_BYTES / 1024 / 1024)}MB.` };
    }
    const v = validateEvidence(u.bytes, u.declaredMime);
    if (!v.ok) return { ok: false, reason: "BAD_FILE", detail: `${u.kind}: ${v.reason}` };
    if (!IDENTITY_MIME.includes(v.mime)) {
      return { ok: false, reason: "BAD_FILE", detail: `${u.kind} must be a JPEG, PNG or WebP image.` };
    }
  }

  const priorAttempts = await prisma.identityVerification.count({ where: { userId } });

  // Store the bytes. Anything already written is rolled back by hand if a later
  // upload throws — there is no transaction across an object store and a
  // database, so the compensating delete IS the cleanup.
  const stored: { kind: DocumentKind; key: string; provider: string; mime: string; size: number; scan: string }[] = [];
  try {
    for (const u of uploads) {
      const v = validateEvidence(u.bytes, u.declaredMime);
      if (!v.ok) throw new Error(v.reason); // re-checked above; keeps the type narrow

      // Scan the ORIGINAL bytes — that is what arrived, and a re-encode could
      // in principle mask a payload the scanner would otherwise catch.
      const scan = await scanBytes(u.bytes);
      if (scan === "INFECTED") {
        return { ok: false, reason: "BAD_FILE", detail: `${u.kind} failed a malware scan and was not stored.` };
      }

      // `putEvidence` does NOT strip metadata — it stores what it is handed. A
      // phone photo of a passport carries GPS coordinates of wherever it was
      // taken, which is usually the person's home, so this is the line that
      // stops us storing that. Re-encoding also drops any trailing appended
      // data that survived the polyglot check.
      const clean = await stripMetadata(u.bytes, v.mime);

      const put = await putEvidence(clean, v.mime);
      stored.push({
        kind: u.kind, key: put.storageKey, provider: put.provider,
        mime: put.contentType, size: put.byteSize, scan,
      });
    }
  } catch (err) {
    await Promise.all(stored.map((s) => deleteEvidence(s.key, s.provider).catch(() => {})));
    return { ok: false, reason: "BAD_FILE", detail: err instanceof Error ? err.message : "Upload failed." };
  }

  const attempt = priorAttempts + 1;
  const deleteAfter = daysFromNow(DOCUMENT_RETENTION_DAYS);

  const created = await prisma.$transaction(async (tx) => {
    const v = await tx.identityVerification.create({
      data: { userId, role: user.registryRole, status: "PENDING", attempt },
      select: { id: true },
    });
    await tx.identityDocument.createMany({
      data: stored.map((s) => ({
        verificationId: v.id, kind: s.kind, storageKey: s.key, storageProvider: s.provider,
        contentType: s.mime, byteSize: s.size, scanStatus: s.scan, deleteAfter,
      })),
    });
    await tx.auditLog.create({
      data: {
        actorId: userId, action: "identity.submit", entity: "IdentityVerification", entityId: v.id,
        meta: { role: user.registryRole, attempt, documents: stored.map((s) => s.kind) },
      },
    });
    return v;
  });

  await notify(prisma, userId, {
    type: "IDENTITY_VERIFICATION",
    title: "Verification submitted",
    body: "We've received your documents. Reviews usually take a few days.",
    url: "/account/verification",
  }).catch(() => {});

  return { ok: true, verificationId: created.id, attempt };
}

export type Decision = "APPROVE" | "DECLINE" | "REQUEST_RESUBMIT";
export type ReviewResult = { ok: true } | { ok: false; reason: "NOT_FOUND" | "NOT_OPEN" | "REASON_REQUIRED" };

/**
 * Record a staff decision.
 *
 * Approval writes `professionalVerifiedAt` on the user in the SAME transaction
 * as the status change and the audit row. The badge is derived from that column,
 * so there is no second flag that can disagree with the decision.
 *
 * Declining requires a reason. A decline the user cannot act on is just a dead
 * end, and "no reason given" is the state that generates support mail.
 */
export async function reviewVerification(
  verificationId: string,
  reviewerId: string,
  decision: Decision,
  opts: { reason?: string; note?: string; ip?: string | null } = {},
): Promise<ReviewResult> {
  const row = await prisma.identityVerification.findUnique({
    where: { id: verificationId },
    select: { id: true, userId: true, status: true, role: true, attempt: true },
  });
  if (!row) return { ok: false, reason: "NOT_FOUND" };
  if (!isOpen(row.status)) return { ok: false, reason: "NOT_OPEN" };

  const reason = opts.reason?.trim() ?? "";
  if (decision !== "APPROVE" && !reason) return { ok: false, reason: "REASON_REQUIRED" };

  const status: VerificationStatus =
    decision === "APPROVE" ? "APPROVED" : decision === "DECLINE" ? "DECLINED" : "RESUBMIT_REQUESTED";
  const now = new Date();

  // ── The decision must be CLAIMED, not just written ────────────────────────
  // The `isOpen` check above is a read, and two reviewers with the same queue
  // open is the ordinary case here, not an exotic race — the route's own error
  // copy says "someone got there first". Check-then-update let both pass the
  // read and both write: two audit rows for one decision, last-write-wins on the
  // status, and — worst — an APPROVE landing after a DECLINE still leaves
  // `professionalVerifiedAt` set, so a rejected applicant ends up wearing a
  // verified badge.
  //
  // `updateMany` with the status in its WHERE is the same guard CLAUDE.md rule 4
  // requires everywhere else: the database decides who won, atomically, and the
  // loser's transaction is rolled back whole by the throw below.
  const NOT_OPEN = Symbol("not-open");
  try {
    await prisma.$transaction(async (tx) => {
      const claimed = await tx.identityVerification.updateMany({
        where: { id: verificationId, status: "PENDING" },
        data: {
          status, reviewedAt: now, reviewerId,
          declineReason: decision === "APPROVE" ? null : reason,
          reviewNote: opts.note?.trim() || null,
        },
      });
      // Zero rows means another reviewer claimed it between the read and here.
      // Throwing rolls back the audit row and the user update with it.
      if (claimed.count === 0) throw NOT_OPEN;

      if (decision === "APPROVE") {
        await tx.user.update({ where: { id: row.userId }, data: { professionalVerifiedAt: now } });
      }

      await tx.auditLog.create({
        data: {
          actorId: reviewerId,
          action: `identity.${decision.toLowerCase()}`,
          entity: "IdentityVerification",
          entityId: verificationId,
          // Previous AND new status, so the history reads as a chain rather than
          // a list of end states.
          meta: {
            previousStatus: row.status, newStatus: status, role: row.role, attempt: row.attempt,
            subjectId: row.userId, reason: reason || null, ip: opts.ip ?? null,
          },
        },
      });
    });
  } catch (err) {
    if (err === NOT_OPEN) return { ok: false, reason: "NOT_OPEN" };
    throw err;
  }

  const message: Record<VerificationStatus, { title: string; body: string }> = {
    APPROVED: { title: "You're verified", body: `Your ${roleLabel(row.role)} identity has been confirmed. Your verified badge is live.` },
    DECLINED: { title: "Verification declined", body: reason },
    RESUBMIT_REQUESTED: { title: "More information needed", body: reason },
    PENDING: { title: "", body: "" },
  };
  await notify(prisma, row.userId, {
    type: "IDENTITY_VERIFICATION",
    title: message[status].title,
    body: message[status].body,
    url: "/account/verification",
  }).catch(() => {});

  return { ok: true };
}

/** The signed-in user's own history — newest first. Never exposes storage keys. */
export async function myVerifications(userId: string) {
  return prisma.identityVerification.findMany({
    where: { userId },
    orderBy: { submittedAt: "desc" },
    select: {
      id: true, status: true, role: true, attempt: true,
      submittedAt: true, reviewedAt: true, declineReason: true,
      // reviewNote is DELIBERATELY absent — it is staff-only.
      documents: { select: { id: true, kind: true, contentType: true, deletedAt: true } },
    },
  });
}

/** Can this user open a new request right now? */
export async function canSubmit(userId: string): Promise<{ allowed: boolean; reason?: string }> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { registryRole: true, professionalVerifiedAt: true },
  });
  if (!user) return { allowed: false, reason: "Account not found." };
  if (!isProfessionalRole(user.registryRole)) {
    return { allowed: false, reason: "Only professional roles need identity verification." };
  }
  if (user.professionalVerifiedAt) return { allowed: false, reason: "You're already verified." };
  const open = await prisma.identityVerification.findFirst({ where: { userId, status: "PENDING" }, select: { id: true } });
  if (open) return { allowed: false, reason: "You already have a review in progress." };
  return { allowed: true };
}

export interface QueueFilters {
  status?: string;
  role?: string;
  q?: string;
  take?: number;
  skip?: number;
}

/** The admin queue. Newest first. */
export async function listVerifications(f: QueueFilters = {}) {
  const where = {
    ...(f.status ? { status: f.status } : {}),
    ...(f.role ? { role: f.role } : {}),
    ...(f.q
      ? {
          user: {
            OR: [
              { email: { contains: f.q, mode: "insensitive" as const } },
              { name: { contains: f.q, mode: "insensitive" as const } },
              { username: { contains: f.q, mode: "insensitive" as const } },
            ],
          },
        }
      : {}),
  };

  const [rows, total] = await Promise.all([
    prisma.identityVerification.findMany({
      where,
      orderBy: { submittedAt: "desc" },
      take: f.take ?? 50,
      skip: f.skip ?? 0,
      select: {
        id: true, status: true, role: true, attempt: true, submittedAt: true, reviewedAt: true,
        user: { select: { id: true, name: true, username: true, email: true, professionalVerifiedAt: true } },
        reviewer: { select: { name: true, username: true } },
        _count: { select: { documents: true } },
      },
    }),
    prisma.identityVerification.count({ where }),
  ]);
  return { rows, total };
}

/** Counters for the admin dashboard card. */
export async function verificationStats(now: Date = new Date()) {
  const startOfDay = new Date(now);
  startOfDay.setHours(0, 0, 0, 0);

  const [pending, approvedToday, declinedToday, recent] = await Promise.all([
    prisma.identityVerification.count({ where: { status: "PENDING" } }),
    prisma.identityVerification.count({ where: { status: "APPROVED", reviewedAt: { gte: startOfDay } } }),
    prisma.identityVerification.count({ where: { status: { in: ["DECLINED", "RESUBMIT_REQUESTED"] } , reviewedAt: { gte: startOfDay } } }),
    prisma.identityVerification.findMany({
      where: { reviewedAt: { not: null } },
      orderBy: { reviewedAt: "desc" },
      take: 50,
      select: { submittedAt: true, reviewedAt: true },
    }),
  ]);

  // Mean over the last 50 decisions rather than all time: a queue that was slow
  // at launch should stop dominating the number six months later.
  const avgMs = recent.length
    ? recent.reduce((a, r) => a + (r.reviewedAt!.getTime() - r.submittedAt.getTime()), 0) / recent.length
    : null;

  return { pending, approvedToday, declinedToday, avgReviewMs: avgMs, sampleSize: recent.length };
}

/**
 * Retention sweep for identity documents.
 *
 * `cleanupExpiredEvidence` in evidence/lifecycle walks `FighterClaim` only — it
 * predates this table and would leave every identity document stored forever,
 * which is the exact failure the retention policy exists to prevent. Same
 * shape, same compensating-delete discipline, different table.
 *
 * The DECISION row is never touched. Bytes expire; the record that a decision
 * was made does not.
 */
export async function cleanupExpiredIdentityDocuments(now: Date = new Date()): Promise<{
  deleted: number; alreadyGone: number; failed: number;
}> {
  const due = await prisma.identityDocument.findMany({
    where: {
      deletedAt: null,
      OR: [
        { deleteAfter: { lte: now } },
        // Retry anything that failed last time; a transient bucket error must
        // not mean a passport is retained indefinitely.
        { deletionStatus: "FAILED" },
      ],
    },
    select: { id: true, storageKey: true, storageProvider: true },
    take: 500,
  });

  let deleted = 0, alreadyGone = 0, failed = 0;
  for (const d of due) {
    const outcome = await deleteEvidence(d.storageKey, d.storageProvider).catch(() => "FAILED" as const);
    if (outcome === "FAILED") {
      failed++;
      await prisma.identityDocument.update({
        where: { id: d.id },
        data: { deletionStatus: "FAILED", deletionError: "delete failed; will retry" },
      });
      continue;
    }
    if (outcome === "ALREADY_ABSENT") alreadyGone++; else deleted++;
    await prisma.identityDocument.update({
      where: { id: d.id },
      data: { deletedAt: new Date(), deletionStatus: "DELETED", deletionError: null },
    });
  }
  return { deleted, alreadyGone, failed };
}
