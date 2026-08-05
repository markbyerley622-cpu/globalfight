import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { isAdminRole } from "@/lib/admin/guard";
import { getEvidenceBytes } from "@/lib/evidence/store";
import { isViewableScanStatus } from "@/lib/evidence/scan";
import { hit, clientIp, POLICY } from "@/lib/rate-limit";
import { log } from "@/lib/scraper/logger";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Stream one identity document to an authorised viewer.
 *
 * Mirrors the claim-evidence readers exactly, including the UNIFORM 404: an
 * anonymous caller, a signed-in stranger, a wrong document id and a genuinely
 * missing row all produce the same response. A 403 here would confirm that a
 * given verification id exists, which turns id enumeration into a list of who
 * has submitted a passport.
 *
 * Only the submitter or staff may read. The bytes never touch a public URL —
 * there is no key in any response body anywhere in this feature, so this
 * endpoint is the only path to them, and it is audited.
 */
export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string; docId: string }> },
) {
  const { id, docId } = await params;
  const user = await getCurrentUser();

  const deny = () => NextResponse.json({ error: "Not found." }, { status: 404 });
  if (!user) return deny();

  const gate = await hit(`identity-doc-read:${user.id}`, POLICY.evidenceRead.limit, POLICY.evidenceRead.windowMs);
  if (!gate.ok) {
    return NextResponse.json(
      { error: "Too many requests." },
      { status: 429, headers: { "retry-after": String(gate.retryAfter) } },
    );
  }

  const doc = await prisma.identityDocument.findUnique({
    where: { id: docId },
    select: {
      verificationId: true, storageKey: true, storageProvider: true, contentType: true,
      scanStatus: true, deletedAt: true,
      verification: { select: { id: true, userId: true } },
    },
  });

  // The docId must belong to the verification in the path. Without this check a
  // valid document id would read out from under ANY verification id.
  if (!doc || doc.verificationId !== id || doc.verification.id !== id) return deny();

  const isOwner = doc.verification.userId === user.id;
  if (!isOwner && !isAdminRole(user.role)) return deny();

  // Retention already removed the bytes. 410 rather than 404: the requester is
  // authorised, so telling them it existed and is gone is correct and useful.
  if (doc.deletedAt) {
    return NextResponse.json({ error: "This document has been deleted under our retention policy." }, { status: 410 });
  }
  if (!isViewableScanStatus(doc.scanStatus)) {
    return NextResponse.json({ error: "This document has not cleared scanning." }, { status: 409 });
  }

  let stored: { body: Buffer; contentType: string } | null;
  try {
    stored = await getEvidenceBytes(doc.storageKey, doc.storageProvider);
  } catch (err) {
    // Never log the key — it is the only secret protecting the object.
    log.error({ docId, err: String(err).slice(0, 120) }, "identity:document-read-failed");
    return NextResponse.json({ error: "Could not read that document." }, { status: 502 });
  }
  if (!stored) return deny();
  const bytes = stored.body;

  // Every successful read of an identity document is recorded. This is the
  // access log the retention and DPIA story depends on.
  await prisma.auditLog.create({
    data: {
      actorId: user.id,
      action: "identity.document.view",
      entity: "IdentityDocument",
      entityId: docId,
      meta: { verificationId: id, asOwner: isOwner, ip: clientIp(req) },
    },
  }).catch(() => {});

  return new NextResponse(new Uint8Array(bytes), {
    status: 200,
    headers: {
      "content-type": doc.contentType,
      "content-length": String(bytes.byteLength),
      // private + no-store keeps it out of shared proxies AND the browser's
      // disk cache; an identity document must not survive on the reviewer's
      // machine after they close the tab.
      "cache-control": "private, no-store, max-age=0, must-revalidate",
      "content-disposition": "inline",
      "x-content-type-options": "nosniff",
      "x-robots-tag": "noindex, nofollow, noarchive, noimageindex",
      // Belt and braces: even if the content type were ever wrong, nothing here
      // is allowed to execute.
      "content-security-policy": "default-src 'none'; img-src 'self'; sandbox",
      "referrer-policy": "no-referrer",
    },
  });
}
