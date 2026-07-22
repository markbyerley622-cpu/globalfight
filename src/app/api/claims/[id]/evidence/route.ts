import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { isAdminRole } from "@/lib/admin/guard";
import { getEvidenceBytes } from "@/lib/evidence/store";
import { isViewableScanStatus } from "@/lib/evidence/scan";
import { hit, POLICY } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Stream a fighter's identity document to an authorized viewer.
 *
 * This is the ONLY path by which these bytes are readable. There is no public
 * URL, no signed link, and nothing cacheable — replacing the previous design
 * where the document sat on a public bucket behind nothing but a UUID.
 *
 * Authorization (in order):
 *   1. authenticated — anonymous callers get 404, not 401, so the endpoint does
 *      not confirm that a given claim id exists;
 *   2. the claimant themselves, or a reviewer (ADMIN/MODERATOR);
 *   3. anyone else gets 404 — an ordinary user probing another user's claim id
 *      cannot tell a real claim from a fake one (no IDOR oracle).
 *
 * The response is `private, no-store`: it must not land in a browser cache, a CDN,
 * or a corporate proxy.
 */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await getCurrentUser();

  // Uniform 404 for every unauthorized case — see note above.
  const deny = () => NextResponse.json({ error: "Not found." }, { status: 404 });

  if (!user) return deny();

  const gate = await hit(`evidence-read:${user.id}`, POLICY.evidenceRead.limit, POLICY.evidenceRead.windowMs);
  if (!gate.ok) {
    return NextResponse.json(
      { error: "Too many requests." },
      { status: 429, headers: { "retry-after": String(gate.retryAfter) } },
    );
  }

  const claim = await prisma.fighterClaim.findUnique({
    where: { id },
    select: {
      id: true,
      claimantId: true,
      evidenceStorageKey: true,
      evidenceStorageProvider: true,
      evidenceContentType: true,
      evidenceScanStatus: true,
      evidenceDeletedAt: true,
    },
  });

  if (!claim) return deny();

  const permitted = claim.claimantId === user.id || isAdminRole(user.role);
  if (!permitted) return deny();

  // Deleted (per retention policy) or never uploaded.
  if (!claim.evidenceStorageKey || claim.evidenceDeletedAt) return deny();

  // A document that failed the scan is never served, to anyone.
  if (!isViewableScanStatus(claim.evidenceScanStatus)) return deny();

  const object = await getEvidenceBytes(claim.evidenceStorageKey, claim.evidenceStorageProvider);
  if (!object) return deny();

  // Audit every read. Who opened whose passport, and when — without recording the
  // storage key or any document content.
  await prisma.auditLog.create({
    data: {
      actorId: user.id,
      action: "claim.evidence.view",
      entity: "FighterClaim",
      entityId: claim.id,
      meta: { viewerRole: user.role, self: claim.claimantId === user.id },
    },
  });

  return new NextResponse(new Uint8Array(object.body), {
    status: 200,
    headers: {
      "content-type": claim.evidenceContentType ?? object.contentType,
      "cache-control": "private, no-store, max-age=0, must-revalidate",
      "content-disposition": "inline",
      // Defence in depth: even if a PDF/image somehow carried active content, the
      // browser must not execute it in our origin.
      "content-security-policy": "default-src 'none'; img-src 'self'; object-src 'none'; sandbox",
      "x-content-type-options": "nosniff",
      "referrer-policy": "no-referrer",
    },
  });
}
