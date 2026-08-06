import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { readImageUpload } from "@/lib/images/upload-policy";
import { refuseIfUgcMediaDisabled } from "@/lib/ugc-guard";
import { ingestMedia, releaseMedia } from "@/lib/media/asset/lifecycle";
import { previewAsset } from "@/lib/gym-posts/media";
import { hit, clientIp, POLICY } from "@/lib/rate-limit";
import { log } from "@/lib/scraper/logger";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// ════════════════════════════════════════════════════════════════════════════
//  THE ONE DOOR TO THE MEDIA LIFECYCLE.
//
//  ── Why this route exists, given "do not build another upload pipeline" ──
//  Because there was no door at all. The lifecycle (validate → scan → process →
//  READY, dedupe, quarantine, reference counting) was merged with no HTTP entry
//  point and no consumer — `ingestMedia` was called from nowhere. This adds the
//  entry, not a pipeline: every line of policy below already existed somewhere
//  and is being CALLED.
//
//      refuseIfUgcMediaDisabled   the launch kill-switch          (ugc-guard)
//      readImageUpload            size, type, magic bytes         (upload-policy)
//      ingestMedia                scan, dedupe, process, publish  (lifecycle)
//
//  ── Why it is /api/media and not /api/gym/posts/media ────────────────────
//  Because the lifecycle deliberately knows nothing about gyms, and a
//  gym-shaped URL would be the first step toward it. Fighter photos, article
//  covers and promotion banners are meant to arrive here too. The response
//  carries an asset id and nothing that addresses storage.
//
//  ── The reference this route gives back ──────────────────────────────────
//  ingestMedia sets refCount to 1 on a new asset (and bumps it on a dedupe
//  hit), which would mean an upload the user then abandons is pinned at one
//  reference forever and cleanupMedia — which only collects at zero — could
//  never reclaim it. So the upload releases that reference immediately.
//
//  The rule it establishes is worth stating: AN UPLOAD IS NOT A CONSUMER. Only
//  an attachment holds a reference. An uploaded-but-unattached asset therefore
//  sits at zero and is swept once it is older than the six-hour grace period —
//  long enough to write a post, short enough that abandoned drafts do not
//  accumulate. See docs/ARCHITECTURE.md.
// ════════════════════════════════════════════════════════════════════════════

export async function POST(req: Request) {
  // The launch kill-switch first: while UGC media is off, nothing else about
  // this request matters. Fails closed by design.
  const disabled = refuseIfUgcMediaDisabled();
  if (disabled) return disabled;

  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Sign in to upload." }, { status: 401 });

  // Per-account AND per-IP. The account limit is the real control; the IP one
  // catches a script cycling throwaway accounts against the scanner's bill.
  const [byUser, byIp] = await Promise.all([
    hit(`media:${user.id}`, POLICY.mediaUpload.limit, POLICY.mediaUpload.windowMs),
    hit(`media-ip:${clientIp(req)}`, POLICY.mediaUpload.limit * 2, POLICY.mediaUpload.windowMs),
  ]);
  const gate = !byUser.ok ? byUser : !byIp.ok ? byIp : null;
  if (gate) {
    return NextResponse.json(
      { error: "Too many uploads. Give it a minute." },
      { status: 429, headers: { "retry-after": String(gate.retryAfter) } },
    );
  }

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ error: "Invalid upload." }, { status: 400 });
  }

  const read = await readImageUpload(form);
  if (!read.ok) return read.response;

  const sourceType = typeof form.get("sourceType") === "string"
    ? String(form.get("sourceType")).slice(0, 40)
    : "gym-post";

  const result = await ingestMedia({
    bytes: read.value.buffer,
    // Declared, never trusted — the lifecycle checks it against the signature.
    declaredMime: read.value.file.type,
    ownerId: user.id,
    // A cleanup/analytics tag. Explicitly NOT an authorization input: it comes
    // from the client, and a string on an asset must never become a capability.
    sourceType,
  });

  if (!result.ok) {
    if (result.status === "REJECTED") {
      // The uploader is NOT told what the scanner found. A precise refusal is a
      // free oracle for tuning a payload until it passes.
      log.warn({ userId: user.id, sourceType }, "media:rejected");
      return NextResponse.json({ error: "We can't accept that file." }, { status: 422 });
    }
    // FAILED is OURS — the scanner was down or the decoder threw. Reported as a
    // server fault, because that is what it is, and it is the signal an
    // operator needs to tell an outage from a blocked attack.
    log.error({ userId: user.id, sourceType, message: result.message }, "media:ingest-failed");
    return NextResponse.json({ error: result.message }, { status: 503 });
  }

  // See the header: hand the ingest reference back before returning.
  await releaseMedia(result.assetId).catch(() => {});

  const preview = await previewAsset(result.assetId);
  if (!preview) {
    // READY with nothing renderable means the processor published under a key
    // this build refuses to serve. Never hand the client an id it cannot use.
    log.error({ assetId: result.assetId }, "media:ready-but-unrenderable");
    return NextResponse.json({ error: "That image couldn't be published." }, { status: 500 });
  }

  return NextResponse.json(
    { ok: true, assetId: result.assetId, deduped: result.deduped, media: preview },
    { status: 201 },
  );
}
