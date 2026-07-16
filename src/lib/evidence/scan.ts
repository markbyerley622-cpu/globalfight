// ════════════════════════════════════════════════════════════════════════
//  Malware scanning for uploaded identity documents.
//
//  HONEST STATUS: no antivirus engine is provisioned for this project. This
//  module is the integration boundary, not a pretend scanner.
//
//  What it does today:
//    • enforces the structural checks that DO have teeth (signature match,
//      polyglot markers, size) — these already ran at upload, re-asserted here
//      so the scan step is meaningful on any path that reaches it;
//    • marks the claim CLEAN or INFECTED, and quarantines (deletes) anything
//      that fails;
//    • when EVIDENCE_SCAN_URL is set, POSTs the bytes to an external scanner
//      (e.g. a ClamAV sidecar) and honours its verdict.
//
//  What it does NOT do: detect actual malware without EVIDENCE_SCAN_URL. The
//  status is recorded as SKIPPED in that case rather than falsely CLEAN, so the
//  gap is visible in the database instead of hidden behind a green tick.
//
//  Reviewers only ever see documents that are CLEAN or SKIPPED — never INFECTED.
// ════════════════════════════════════════════════════════════════════════

import "server-only";
import { prisma } from "@/lib/db";
import { sniffMime, looksLikePolyglot } from "@/lib/evidence/store";
import { deleteClaimEvidence } from "@/lib/evidence/lifecycle";
import { log } from "@/lib/scraper/logger";

export type ScanStatus = "CLEAN" | "INFECTED" | "SKIPPED";

async function externalScan(body: Buffer): Promise<boolean | null> {
  const url = process.env.EVIDENCE_SCAN_URL;
  if (!url) return null;
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/octet-stream" },
      body: new Uint8Array(body),
      signal: AbortSignal.timeout(20_000),
    });
    if (!res.ok) return null;
    const verdict = (await res.json()) as { infected?: boolean };
    return verdict.infected === true;
  } catch (e) {
    log.warn({ err: (e as Error).message }, "evidence:scan-unreachable");
    return null; // treat as "couldn't scan", never as "clean"
  }
}

/**
 * Scan a stored document and record the outcome on the claim. An INFECTED result
 * deletes the object immediately — we do not keep known-bad bytes around, and a
 * reviewer must never be handed them.
 */
export async function scanEvidence(claimId: string, body: Buffer): Promise<ScanStatus> {
  // Structural re-check. These are the checks that actually hold: a file whose
  // signature isn't one of our four formats, or that carries script markers, is
  // rejected regardless of what any AV says.
  const structurallyBad = sniffMime(body) === null || looksLikePolyglot(body);

  const infected = structurallyBad ? true : await externalScan(body);

  if (infected === true) {
    await prisma.fighterClaim.update({
      where: { id: claimId },
      data: { evidenceScanStatus: "INFECTED" },
    });
    // Quarantine by deletion: remove the object and the reference.
    await deleteClaimEvidence(claimId, "admin.manual");
    await prisma.auditLog.create({
      data: { actorId: null, action: "claim.evidence.rejected_by_scan", entity: "FighterClaim", entityId: claimId },
    });
    return "INFECTED";
  }

  const status: ScanStatus = infected === false ? "CLEAN" : "SKIPPED";
  await prisma.fighterClaim.update({ where: { id: claimId }, data: { evidenceScanStatus: status } });
  return status;
}

/**
 * May a reviewer open this document?
 *
 *   CLEAN    → yes.
 *   INFECTED → never. (The object is deleted anyway.)
 *   PENDING  → no. A scan that has not finished is not a scan.
 *   SKIPPED  → depends on policy, below.
 *   null     → legacy/migrated rows that predate scanning; treated as SKIPPED.
 *
 * SKIPPED means "no scanner was configured, so nothing checked this for malware".
 * The default is to ALLOW review, because blocking it would halt fighter
 * verification entirely on a project with no AV provisioned — that is an ACCEPTED
 * RISK, documented in docs/SECURITY-IDENTITY-EVIDENCE.md, and the reviewer sees an
 * explicit "NOT scanned" warning in the UI rather than a false all-clear.
 *
 * Set EVIDENCE_REQUIRE_SCAN=true to fail closed instead: unscanned documents become
 * unopenable, and claims cannot be reviewed until a real scanner is configured.
 */
export function isViewableScanStatus(status: string | null): boolean {
  if (status === "CLEAN") return true;
  if (status === "INFECTED" || status === "PENDING" || status === "FAILED") return false;

  // SKIPPED / null
  return process.env.EVIDENCE_REQUIRE_SCAN !== "true";
}
