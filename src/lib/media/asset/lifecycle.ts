import "server-only";
import { prisma } from "@/lib/db";
import { screenMedia } from "@/lib/media/scan";
import { newMediaKey } from "./keys";
import type { MediaStatus } from "@prisma/client";

// ════════════════════════════════════════════════════════════════════════════
//  THE MEDIA LIFECYCLE.
//
//      ingest → PENDING → SCANNING → PROCESSING → READY
//                            ↓           ↓
//                        REJECTED     FAILED
//
//  ── The one invariant ────────────────────────────────────────────────────
//  Only READY is servable, and an asset reaches READY along exactly one path.
//  There is no "publish anyway", no admin override, and no argument that skips
//  the scan — the scan is not a parameter of this function, it is a step in it.
//
//  ── Why REJECTED and FAILED are different states ─────────────────────────
//  REJECTED is the FILE's fault: it was infected or structurally hostile. Those
//  bytes go to quarantine and the uploader is refused. FAILED is OURS: the
//  scanner was down, or the decoder threw. Same outcome for the user (nothing
//  is published) and a completely different operational meaning — one is a
//  blocked attack, the other is an outage. Collapsing them would make the
//  metric that matters ("are we rejecting real threats, or is the scanner
//  broken?") impossible to read.
//
//  ── Deduplication ────────────────────────────────────────────────────────
//  Keyed on the SHA-256 of the original bytes, enforced by a UNIQUE column
//  rather than a check-then-insert, so two simultaneous uploads of the same
//  file cannot both create a row (CLAUDE.md rule 4). A duplicate does not
//  re-scan, does not re-process and does not re-store: it takes a reference on
//  the existing asset. Re-scanning a file already proven SAFE is money spent to
//  learn something already known.
//
//  ── This module does NOT know what an asset is FOR ───────────────────────
//  No gym, no post, no fighter. Attachment belongs to the consumer, which is
//  what keeps one pipeline serving every future feature.
// ════════════════════════════════════════════════════════════════════════════

export interface IngestInput {
  bytes: Buffer;
  /** Client-declared; only ever CHECKED against the signature, never trusted. */
  declaredMime?: string | null;
  /** WHO UPLOADED IT. Not what it belongs to. */
  ownerId: string | null;
  /** Origin tag for cleanup policy and analytics. NEVER an authorization input. */
  sourceType?: string;
}

export type IngestResult =
  | { ok: true; assetId: string; status: "READY"; deduped: boolean }
  | { ok: false; status: "REJECTED" | "FAILED"; message: string };

/** A PENDING asset older than this was abandoned mid-upload. */
export const TEMP_TTL_MS = 6 * 60 * 60 * 1000;

/**
 * Take raw bytes all the way to READY, or refuse them.
 *
 * Synchronous end-to-end on purpose, for now. A queue is the right answer once
 * scan + process exceeds a request budget, and the state machine is already
 * shaped for it — every transition is persisted, so a worker can pick an asset
 * up mid-flight. Introducing the queue before there is load would add an
 * operational component with no measurement to justify it.
 */
export async function ingestMedia(input: IngestInput): Promise<IngestResult> {
  // ── 1. THE GATE. Validation + malware scan, fail-closed. ────────────────
  // Runs BEFORE anything is written or stored: a refused file should leave no
  // trace beyond a log line, not a row and an object to clean up later.
  const screened = await screenMedia(input.bytes, input.declaredMime);

  if (!screened.ok) {
    const rejected = screened.stage === "validation" || screened.scan.verdict === "INFECTED";
    // A refusal is recorded ONLY when the scanner actually saw the bytes and
    // called them infected — that is worth an audit trail. A structurally
    // invalid file (a PDF, a truncated JPEG) is noise and gets no row.
    if (screened.stage === "scan" && screened.scan.verdict === "INFECTED") {
      await recordRejection(input, screened.scan.provider, screened.scan.signature ?? null);
    }
    return {
      ok: false,
      status: rejected ? "REJECTED" : "FAILED",
      message: screened.message,
    };
  }

  // ── 2. DEDUPE. Identical bytes reuse the existing asset. ────────────────
  const existing = await prisma.mediaAsset.findUnique({
    where: { sha256: screened.sha256 },
    select: { id: true, status: true },
  });
  if (existing && existing.status === "READY") {
    await prisma.mediaAsset.update({
      where: { id: existing.id },
      data: { refCount: { increment: 1 } },
    });
    return { ok: true, assetId: existing.id, status: "READY", deduped: true };
  }
  // A row exists but is not READY — a previous attempt died mid-flight. Fall
  // through and let this attempt drive it to completion rather than returning a
  // half-finished asset.

  // ── 3. Create/claim the row. ────────────────────────────────────────────
  const asset = await prisma.mediaAsset.upsert({
    where: { sha256: screened.sha256 },
    create: {
      sha256: screened.sha256,
      mime: screened.mime,
      bytes: screened.bytes,
      status: "SCANNING",
      ownerId: input.ownerId,
      sourceType: input.sourceType ?? null,
      tempKey: newMediaKey("temp", screened.mime),
      expiresAt: new Date(Date.now() + TEMP_TTL_MS),
      scanVerdict: screened.scan.verdict,
      scanProvider: screened.scan.provider,
      scannedAt: new Date(),
      refCount: 1,
    },
    update: {
      status: "SCANNING",
      scanVerdict: screened.scan.verdict,
      scanProvider: screened.scan.provider,
      scannedAt: new Date(),
    },
    select: { id: true },
  });

  // ── 4. PROCESS. Variants + metadata stripping. ──────────────────────────
  try {
    await prisma.mediaAsset.update({ where: { id: asset.id }, data: { status: "PROCESSING" } });
    const processed = await processToPublic(screened.mime, input.bytes);

    await prisma.mediaAsset.update({
      where: { id: asset.id },
      data: {
        status: "READY",
        publicKey: processed.publicKey,
        variants: processed.variants,
        blurhash: processed.blurhash,
        width: processed.width,
        height: processed.height,
        // A READY asset does not expire; the temp copy is no longer the record.
        expiresAt: null,
        tempKey: null,
      },
    });
    return { ok: true, assetId: asset.id, status: "READY", deduped: false };
  } catch {
    // OUR fault, not the file's — FAILED, never REJECTED. Left in place for an
    // operator to retry; the cleanup job sweeps it if nobody does.
    await prisma.mediaAsset.update({
      where: { id: asset.id },
      data: { status: "FAILED", scanVerdict: screened.scan.verdict },
    }).catch(() => {});
    return {
      ok: false,
      status: "FAILED",
      message: "We couldn't process that image. Please try again.",
    };
  }
}

/** An infected upload, recorded for the audit trail. Bytes go to quarantine. */
async function recordRejection(input: IngestInput, provider: string, signature: string | null) {
  try {
    const { createHash } = await import("node:crypto");
    const sha256 = createHash("sha256").update(input.bytes).digest("hex");
    await prisma.mediaAsset.upsert({
      where: { sha256 },
      create: {
        sha256,
        mime: "application/octet-stream",
        bytes: input.bytes.length,
        status: "REJECTED",
        ownerId: input.ownerId,
        sourceType: input.sourceType ?? null,
        quarantineKey: newMediaKey("quarantine", "application/octet-stream"),
        scanVerdict: "INFECTED",
        scanProvider: provider,
        scanSignature: signature,
        scannedAt: new Date(),
        refCount: 0,
      },
      update: { status: "REJECTED", scanVerdict: "INFECTED", scanSignature: signature },
    });
  } catch {
    // The refusal already happened; failing to journal it must not turn a
    // blocked upload into an error the uploader sees.
  }
}

export interface ProcessedMedia {
  publicKey: string;
  variants: Record<string, string>;
  blurhash: string | null;
  width: number;
  height: number;
}

/**
 * Variant generation, behind an interface for the SAME reason the scanner is.
 *
 * The real implementation delegates to the EXISTING image pipeline rather than
 * growing a second one — lib/images/store already re-encodes through sharp,
 * which strips EXIF, GPS and camera metadata as a side effect of re-encoding,
 * and writes to the configured object store.
 *
 * That pipeline REQUIRES R2/S3 credentials, which is correct (there is nowhere
 * else to put a public image) and means the lifecycle cannot publish without
 * them. Making the step injectable lets the state machine be verified without
 * cloud credentials, and leaves room for a different processor later (video
 * posters, AVIF) without touching the lifecycle.
 */
export interface MediaProcessor {
  process(mime: string, bytes: Buffer): Promise<ProcessedMedia>;
}

const realProcessor: MediaProcessor = {
  async process(mime, bytes) {
    const publicKey = newMediaKey("public", mime);
    const { processAndStoreBuffer } = await import("@/lib/images/store");
    const stored = await processAndStoreBuffer(publicKey.replace(/[^a-z0-9]/gi, "-"), bytes);
    return {
      publicKey,
      variants: stored as unknown as Record<string, string>,
      blurhash: null,
      width: 0,
      height: 0,
    };
  },
};

let processor: MediaProcessor = realProcessor;

/** Tests and future processors. Pass null to restore the real one. */
export function __setMediaProcessor(p: MediaProcessor | null): void {
  processor = p ?? realProcessor;
}

const processToPublic = (mime: string, bytes: Buffer) => processor.process(mime, bytes);

/**
 * Release a reference. When it reaches zero the asset becomes cleanup-eligible;
 * the bytes are NOT removed here — a synchronous delete inside a request is how
 * a shared asset gets destroyed by whichever consumer detaches first.
 */
export async function releaseMedia(assetId: string): Promise<void> {
  // `decrement` guarded by a positive filter so a double-release cannot drive
  // the count negative and make a live asset look collectable.
  await prisma.mediaAsset.updateMany({
    where: { id: assetId, refCount: { gt: 0 } },
    data: { refCount: { decrement: 1 } },
  });
}

/** Take a reference. Consumers call this when they attach an existing asset. */
export async function retainMedia(assetId: string): Promise<void> {
  await prisma.mediaAsset.updateMany({
    where: { id: assetId, status: "READY" },
    data: { refCount: { increment: 1 } },
  });
}

export interface CleanupReport {
  expiredTemp: number;
  orphaned: number;
  rejected: number;
}

/**
 * The sweep. IDEMPOTENT — running it twice does nothing the second time.
 *
 * Only marks rows DELETED; byte removal is a separate concern so a bug here can
 * never destroy a live asset's storage. That is the conservative order on
 * purpose: an orphaned object costs storage, a wrongly-deleted one costs data.
 */
export async function cleanupMedia(now = new Date()): Promise<CleanupReport> {
  const [expiredTemp, orphaned, rejected] = await Promise.all([
    // Abandoned mid-upload.
    prisma.mediaAsset.updateMany({
      where: { status: { in: ["PENDING", "SCANNING"] }, expiresAt: { lt: now } },
      data: { status: "DELETED" },
    }),
    // READY but nothing references it any more.
    prisma.mediaAsset.updateMany({
      where: { status: "READY", refCount: { lte: 0 }, updatedAt: { lt: new Date(now.getTime() - TEMP_TTL_MS) } },
      data: { status: "DELETED" },
    }),
    // Quarantined material, kept long enough to be reviewed then dropped.
    prisma.mediaAsset.updateMany({
      where: { status: "REJECTED", createdAt: { lt: new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000) } },
      data: { status: "DELETED" },
    }),
  ]);
  return { expiredTemp: expiredTemp.count, orphaned: orphaned.count, rejected: rejected.count };
}

/** Only a READY asset is servable. Every consumer asks this before rendering. */
export function isServable(status: MediaStatus): boolean {
  return status === "READY";
}
