import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import {
  validateEvidence, stripMetadata, putEvidence, MAX_EVIDENCE_BYTES,
  type AcceptedMime,
} from "@/lib/evidence/store";
import { scanEvidence } from "@/lib/evidence/scan";
import { PENDING_TTL_DAYS, daysFromNow } from "@/lib/evidence/lifecycle";
import { hit, POLICY } from "@/lib/rate-limit";
import { log } from "@/lib/scraper/logger";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// ════════════════════════════════════════════════════════════════════════════
//  Proof of gym ownership — a photo, not a paragraph.
//
//  A gym claim previously accepted only free text, so "how can we verify you?"
//  was answered with a sentence an admin had to take on faith. This lets a
//  claimant attach a business licence, a utility bill, or a photo of the
//  signage, and the admin actually SEE it.
//
//  It reuses the identity-evidence pipeline wholesale (src/lib/evidence/*):
//  private bucket, magic-byte sniffing, polyglot rejection, EXIF stripping,
//  virus scan, and a retention deadline the cleanup cron already honours.
//
//  Deliberately NOT the gym MEDIA pipeline: gym photos are public content.
//  This is a private document about a person's business, it must never get a
//  public URL, and it is deleted on a schedule. Same reason FighterClaim has
//  its own path rather than posting an ID card to the avatar endpoint.
// ════════════════════════════════════════════════════════════════════════════

export async function POST(req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Sign in." }, { status: 401 });

  const gate = await hit(`gym-evidence:${user.id}`, POLICY.evidenceRead.limit, POLICY.evidenceRead.windowMs);
  if (!gate.ok) {
    return NextResponse.json(
      { error: "Too many uploads. Try again shortly." },
      { status: 429, headers: { "retry-after": String(gate.retryAfter) } },
    );
  }

  const gym = await prisma.gym.findUnique({ where: { slug }, select: { id: true } });
  if (!gym) return NextResponse.json({ error: "No such gym." }, { status: 404 });

  // Attach to the caller's OWN open claim. There is no claimId in the request,
  // so one user cannot bolt a document onto somebody else's claim.
  const claim = await prisma.gymClaim.findFirst({
    where: { gymId: gym.id, claimantId: user.id, status: { in: ["pending", "info_requested"] } },
    orderBy: { createdAt: "desc" },
    select: { id: true },
  });
  if (!claim) {
    return NextResponse.json({ error: "File a claim first, then attach your proof." }, { status: 409 });
  }

  let form: FormData;
  try { form = await req.formData(); } catch { return NextResponse.json({ error: "Invalid upload." }, { status: 400 }); }

  const file = form.get("file");
  if (!(file instanceof File)) return NextResponse.json({ error: "No file provided." }, { status: 400 });
  if (file.size > MAX_EVIDENCE_BYTES) return NextResponse.json({ error: "The file must be under 8 MB." }, { status: 413 });

  const raw = Buffer.from(await file.arrayBuffer());
  const check = validateEvidence(raw, file.type);
  if (!check.ok) return NextResponse.json({ error: check.reason }, { status: 415 });

  try {
    // Strip EXIF before it is stored: a photo of a shopfront otherwise carries
    // the GPS coordinates of whoever took it.
    const cleaned = await stripMetadata(raw, check.mime as AcceptedMime);
    const scan = await scanEvidence(claim.id, cleaned);
    if (scan === "INFECTED") {
      return NextResponse.json({ error: "That file failed a security scan." }, { status: 422 });
    }

    const stored = await putEvidence(cleaned, check.mime as AcceptedMime);

    await prisma.gymClaim.update({
      where: { id: claim.id },
      data: {
        evidenceStorageKey: stored.storageKey,
        evidenceStorageProvider: stored.provider,
        evidenceContentType: stored.contentType,
        evidenceByteSize: stored.byteSize,
        evidenceUploadedAt: new Date(),
        evidenceScanStatus: scan,
        evidenceDeleteAfter: daysFromNow(PENDING_TTL_DAYS),
      },
    });

    // The key is never returned — the client has no use for it and it is the
    // one value that must not leak.
    return NextResponse.json({ ok: true, claimId: claim.id, scan });
  } catch (e) {
    log.error({ claimId: claim.id, err: (e as Error).message }, "gym-claim:evidence-failed");
    return NextResponse.json(
      { error: "Could not store the document securely. Please try again." },
      { status: 500 },
    );
  }
}

