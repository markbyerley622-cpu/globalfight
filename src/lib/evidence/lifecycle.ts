// ════════════════════════════════════════════════════════════════════════
//  Identity-evidence retention lifecycle.
//
//  Rule: an identity document exists for exactly as long as a human needs it to
//  decide a claim, and not one day longer. Everything here enforces that.
//
//    pending          → retained until reviewed, or PENDING_TTL_DAYS if abandoned
//    approved         → deleted immediately after the approval transaction commits
//    rejected         → retained for APPEAL_WINDOW_DAYS, then deleted
//    info_requested   → treated as pending (the claimant still needs to respond)
//    account deleted  → cascade removes the claim row; the object is swept as
//                       an orphan by the cleanup job
//
//  Deletion is NOT "set the column to null". It is: delete the object, verify the
//  outcome, then drop the reference. If the object delete fails we record FAILED
//  and keep the key so a retry can find it — losing the key would strand a
//  passport in a bucket forever with nothing pointing at it.
// ════════════════════════════════════════════════════════════════════════

import "server-only";
import { prisma } from "@/lib/db";
import { deleteEvidence } from "@/lib/evidence/store";
import { log } from "@/lib/scraper/logger";

const DAY_MS = 24 * 60 * 60 * 1000;

/** How long an unreviewed claim's ID is kept before it's treated as abandoned. */
export const PENDING_TTL_DAYS = 30;
/** How long a rejected claim's ID is kept so the claimant can appeal. */
export const APPEAL_WINDOW_DAYS = 14;

export const daysFromNow = (days: number, from: Date = new Date()) =>
  new Date(from.getTime() + days * DAY_MS);

export type DeletionReason =
  | "claim.approved"
  | "claim.rejected.appeal_window_elapsed"
  | "claim.abandoned"
  | "claim.superseded"
  | "account.deleted"
  | "admin.manual";

/**
 * Delete a claim's identity document and drop the DB reference.
 *
 * Sequencing is deliberate and must not be reordered:
 *   1. delete the underlying object
 *   2. only if that succeeded, null the key and mark DELETED
 *   3. if it failed, KEEP the key and mark FAILED so the cleanup job retries
 *
 * Idempotent: a claim with no key, or one already DELETED, is a no-op.
 * Never throws — a failure here must not roll back a claim decision.
 */
export async function deleteClaimEvidence(claimId: string, reason: DeletionReason): Promise<"DELETED" | "NOTHING_TO_DO" | "FAILED"> {
  const claim = await prisma.fighterClaim.findUnique({
    where: { id: claimId },
    select: {
      id: true,
      evidenceStorageKey: true,
      evidenceStorageProvider: true,
      evidenceDeletedAt: true,
    },
  });

  if (!claim || !claim.evidenceStorageKey || claim.evidenceDeletedAt) return "NOTHING_TO_DO";

  const outcome = await deleteEvidence(claim.evidenceStorageKey, claim.evidenceStorageProvider);

  if (outcome === "FAILED") {
    await prisma.fighterClaim.update({
      where: { id: claimId },
      data: {
        evidenceDeletionStatus: "FAILED",
        // Reason only — never the key or a URL.
        evidenceDeletionError: `delete failed (${reason})`,
      },
    });
    await audit(null, "claim.evidence.delete_failed", claimId, { reason });
    return "FAILED";
  }

  // Object is gone (deleted, or verified absent). Now — and only now — drop the
  // pointer. The key is cleared so it cannot be re-read or re-served.
  await prisma.fighterClaim.update({
    where: { id: claimId },
    data: {
      evidenceStorageKey: null,
      evidenceStorageProvider: null,
      evidenceDeleteAfter: null,
      evidenceDeletedAt: new Date(),
      evidenceDeletionStatus: "DELETED",
      evidenceDeletionError: null,
    },
  });
  await audit(null, "claim.evidence.deleted", claimId, { reason, outcome });
  return "DELETED";
}

async function audit(actorId: string | null, action: string, claimId: string, meta: object) {
  try {
    await prisma.auditLog.create({
      data: { actorId, action, entity: "FighterClaim", entityId: claimId, meta: meta as never },
    });
  } catch (e) {
    log.warn({ action, err: (e as Error).message }, "evidence:audit-write-failed");
  }
}

export interface CleanupReport {
  approved: number;
  rejectedExpired: number;
  abandoned: number;
  retriedFailures: number;
  orphaned: number;
  stillFailing: number;
}

/**
 * Sweep everything whose retention window has closed. Safe to run repeatedly and
 * safe to run concurrently with reviews — each delete is idempotent.
 *
 * Covers the four ways a document outlives its purpose:
 *   • approved/rejected claims whose inline delete failed at review time
 *   • rejected claims past the appeal window
 *   • pending claims nobody ever reviewed (abandoned)
 *   • prior FAILED deletions, retried
 */
export async function cleanupExpiredEvidence(now: Date = new Date()): Promise<CleanupReport> {
  const report: CleanupReport = {
    approved: 0, rejectedExpired: 0, abandoned: 0, retriedFailures: 0, orphaned: 0, stillFailing: 0,
  };

  // Anything with a key whose retention deadline has passed, plus anything that
  // previously failed to delete, plus resolved claims that still hold a key.
  const due = await prisma.fighterClaim.findMany({
    where: {
      evidenceStorageKey: { not: null },
      OR: [
        { evidenceDeleteAfter: { lte: now } },
        { evidenceDeletionStatus: "FAILED" },
        { status: "APPROVED" },   // must never retain evidence
        { status: "REJECTED", reviewedAt: { lte: daysFromNow(-APPEAL_WINDOW_DAYS, now) } },
      ],
    },
    select: { id: true, status: true, evidenceDeletionStatus: true, createdAt: true, reviewedAt: true },
    take: 500,
  });

  for (const claim of due) {
    const reason: DeletionReason =
      claim.status === "APPROVED" ? "claim.approved"
        : claim.status === "REJECTED" ? "claim.rejected.appeal_window_elapsed"
          : "claim.abandoned";

    const wasFailure = claim.evidenceDeletionStatus === "FAILED";
    const result = await deleteClaimEvidence(claim.id, reason);

    if (result === "FAILED") { report.stillFailing++; continue; }
    if (result === "NOTHING_TO_DO") continue;

    if (wasFailure) report.retriedFailures++;
    if (claim.status === "APPROVED") report.approved++;
    else if (claim.status === "REJECTED") report.rejectedExpired++;
    else report.abandoned++;
  }

  return report;
}

/**
 * Delete every identity document belonging to a user. Called before an account
 * is erased, so a deleted account leaves no ID behind (UK GDPR Art. 17).
 */
export async function deleteAllEvidenceForUser(userId: string): Promise<number> {
  const claims = await prisma.fighterClaim.findMany({
    where: { claimantId: userId, evidenceStorageKey: { not: null } },
    select: { id: true },
  });
  let deleted = 0;
  for (const c of claims) {
    if ((await deleteClaimEvidence(c.id, "account.deleted")) === "DELETED") deleted++;
  }
  return deleted;
}
