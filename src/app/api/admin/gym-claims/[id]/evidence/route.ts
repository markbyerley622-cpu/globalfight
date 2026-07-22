import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { getEvidenceBytes } from "@/lib/evidence/store";
import { isViewableScanStatus } from "@/lib/evidence/scan";
import { hit, POLICY } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const isReviewer = (role: string) => role === "ADMIN" || role === "MODERATOR";

/**
 * Stream a gym claim's proof document to an authorised viewer.
 *
 * Mirrors the fighter-claim evidence reader exactly, including its uniform-404
 * posture: an anonymous or unauthorised caller gets 404, never 401/403, so
 * probing claim ids cannot confirm which ones exist (no IDOR oracle).
 *
 * Only the claimant themselves or a reviewer may read it, the response is
 * `private, no-store` so it never lands in a browser cache or a proxy, and a
 * document that has not cleared the scanner is refused outright.
 */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await getCurrentUser();

  const deny = () => NextResponse.json({ error: "Not found." }, { status: 404 });
  if (!user) return deny();

  const gate = await hit(`gym-evidence-read:${user.id}`, POLICY.evidenceRead.limit, POLICY.evidenceRead.windowMs);
  if (!gate.ok) {
    return NextResponse.json(
      { error: "Too many requests." },
      { status: 429, headers: { "retry-after": String(gate.retryAfter) } },
    );
  }

  const claim = await prisma.gymClaim.findUnique({
    where: { id },
    select: {
      claimantId: true,
      evidenceStorageKey: true,
      evidenceStorageProvider: true,
      evidenceContentType: true,
      evidenceScanStatus: true,
      evidenceDeletedAt: true,
    },
  });
  if (!claim) return deny();
  if (claim.claimantId !== user.id && !isReviewer(user.role)) return deny();
  if (!claim.evidenceStorageKey || claim.evidenceDeletedAt) return deny();
  if (!isViewableScanStatus(claim.evidenceScanStatus)) {
    return NextResponse.json({ error: "This document is still being checked." }, { status: 409 });
  }

  const object = await getEvidenceBytes(claim.evidenceStorageKey, claim.evidenceStorageProvider);
  if (!object) return deny();

  // Audit every read, exactly as the fighter reader does: who opened whose
  // document, and when — never the storage key or any content.
  await prisma.auditLog.create({
    data: {
      actorId: user.id,
      action: "gym-claim.evidence.view",
      entity: "GymClaim",
      entityId: id,
      meta: { viewerRole: user.role, self: claim.claimantId === user.id },
    },
  });

  return new NextResponse(new Uint8Array(object.body), {
    headers: {
      "content-type": claim.evidenceContentType ?? object.contentType,
      "content-disposition": "inline",
      "cache-control": "private, no-store",
      "x-content-type-options": "nosniff",
    },
  });
}
