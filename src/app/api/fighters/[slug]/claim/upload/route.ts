import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { putEvidence, validateEvidence, stripMetadata, MAX_EVIDENCE_BYTES } from "@/lib/evidence/store";
import { daysFromNow, PENDING_TTL_DAYS } from "@/lib/evidence/lifecycle";
import { hit, clientIp, POLICY } from "@/lib/rate-limit";
import { log } from "@/lib/scraper/logger";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Accept a fighter's identity document for a profile claim.
 *
 * What changed and why:
 *   • The document is stored PRIVATELY and the response no longer contains a URL.
 *     The old route returned a permanent public URL to the browser; anyone with
 *     that link — forwarded, logged, or leaked from a proxy — could read a
 *     passport with no authentication at all.
 *   • The bytes are validated by signature, not by the browser's declared type.
 *   • The claim row is updated server-side. The client never supplies a storage
 *     key, so it cannot point its claim at somebody else's document.
 */
export async function POST(req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Sign in required." }, { status: 401 });

  const gate = await hit(`evidence-up:${user.id}`, POLICY.evidenceUpload.limit, POLICY.evidenceUpload.windowMs);
  if (!gate.ok) {
    return NextResponse.json(
      { error: "Too many uploads. Try again later." },
      { status: 429, headers: { "retry-after": String(gate.retryAfter) } },
    );
  }
  await hit(`evidence-up-ip:${clientIp(req)}`, POLICY.evidenceUpload.limit * 3, POLICY.evidenceUpload.windowMs);

  // The fighter must exist and be unclaimed. The old route accepted any slug from
  // any signed-in user, so anyone could push files into storage under any slug.
  const fighter = await prisma.fighter.findUnique({
    where: { slug },
    select: { id: true, ownerId: true },
  });
  if (!fighter) return NextResponse.json({ error: "Profile not found." }, { status: 404 });
  if (fighter.ownerId) {
    return NextResponse.json({ error: "This profile is already verified to an owner." }, { status: 409 });
  }

  let form: FormData;
  try { form = await req.formData(); } catch { return NextResponse.json({ error: "Invalid upload." }, { status: 400 }); }

  const file = form.get("file");
  if (!(file instanceof File)) return NextResponse.json({ error: "No file provided." }, { status: 400 });
  if (file.size > MAX_EVIDENCE_BYTES) {
    return NextResponse.json({ error: "File must be under 8 MB." }, { status: 400 });
  }

  const raw = Buffer.from(await file.arrayBuffer());
  const verdict = validateEvidence(raw, file.type);
  if (!verdict.ok) return NextResponse.json({ error: verdict.reason }, { status: 400 });

  try {
    const cleaned = await stripMetadata(raw, verdict.mime);
    const stored = await putEvidence(cleaned, verdict.mime);

    // Attach to the claimant's own claim, creating it in PENDING if needed. The
    // composite unique key is (fighterId, claimantId), so a user can only ever
    // write to their own claim row — there is no id in the request to tamper with.
    const claim = await prisma.fighterClaim.upsert({
      where: { fighterId_claimantId: { fighterId: fighter.id, claimantId: user.id } },
      create: {
        fighterId: fighter.id,
        claimantId: user.id,
        status: "PENDING",
        evidenceType: "id_document",
        evidenceStorageKey: stored.storageKey,
        evidenceStorageProvider: stored.provider,
        evidenceContentType: stored.contentType,
        evidenceByteSize: stored.byteSize,
        evidenceUploadedAt: new Date(),
        evidenceDeleteAfter: daysFromNow(PENDING_TTL_DAYS),
        evidenceScanStatus: "PENDING",
        evidenceDeletionStatus: null,
      },
      update: {
        evidenceType: "id_document",
        evidenceStorageKey: stored.storageKey,
        evidenceStorageProvider: stored.provider,
        evidenceContentType: stored.contentType,
        evidenceByteSize: stored.byteSize,
        evidenceUploadedAt: new Date(),
        evidenceDeleteAfter: daysFromNow(PENDING_TTL_DAYS),
        evidenceDeletedAt: null,
        evidenceDeletionStatus: null,
        evidenceDeletionError: null,
        evidenceScanStatus: "PENDING",
      },
      select: { id: true, evidenceStorageKey: true, evidenceStorageProvider: true },
    });

    // Scan before a reviewer can open it. Runs inline for now (see scan.ts) and is
    // the seam where a real AV integration plugs in.
    const { scanEvidence } = await import("@/lib/evidence/scan");
    await scanEvidence(claim.id, cleaned);

    await prisma.auditLog.create({
      data: {
        actorId: user.id,
        action: "claim.evidence.upload",
        entity: "FighterClaim",
        entityId: claim.id,
        // Metadata only. Never the key, never the bytes, never a document number.
        meta: { contentType: stored.contentType, byteSize: stored.byteSize, provider: stored.provider },
      },
    });

    // No URL and no storage key in the response — the client has no business
    // holding either. It just needs to know the upload landed.
    return NextResponse.json({ ok: true, uploaded: true });
  } catch (e) {
    log.warn({ err: (e as Error).message }, "claim:evidence-upload-failed");
    return NextResponse.json({ error: "Could not store the document. Please try again." }, { status: 500 });
  }
}
