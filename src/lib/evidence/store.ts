// ════════════════════════════════════════════════════════════════════════
//  Private evidence storage — fighter identity documents.
//
//  This module is deliberately SEPARATE from src/lib/images/store.ts. That one
//  exists to publish images: it uploads with `access: "public"`, returns a
//  permanent public URL, and falls back to writing under `public/` where Next
//  serves it statically. Every one of those properties is a vulnerability when
//  the payload is a passport.
//
//  Invariants enforced here:
//    • objects are private — no public ACL, no public base URL, no public/ dir
//    • the caller receives an opaque storage KEY, never a fetchable address
//    • bytes are handed out only via getEvidenceBytes(), behind authorization
//    • keys are random and carry no user/fighter identifiers
//    • production REFUSES to fall back to a public or world-readable backend
//
//  Backends, in order:
//    • Cloudflare R2 / S3 private bucket — EVIDENCE_R2_* (production)
//    • Local private dir — EVIDENCE_LOCAL_DIR, default .private/evidence
//      (dev only; outside the repo's served tree and gitignored)
// ════════════════════════════════════════════════════════════════════════

import "server-only";
import { promises as fs } from "node:fs";
import path from "node:path";
import { randomUUID, randomBytes } from "node:crypto";
import { log } from "@/lib/scraper/logger";
import { assertPrivateBucketConfig } from "./config";

export type EvidenceProvider = "r2" | "local-private";

export interface StoredEvidence {
  storageKey: string;
  provider: EvidenceProvider;
  byteSize: number;
  contentType: string;
}

const isProd = () => process.env.NODE_ENV === "production";

// ── Accepted formats ──────────────────────────────────────────────────────
// Deliberately narrow. No SVG (scriptable), no HTML, no archives, no Office
// formats, no HEIC (its container is a polyglot risk and sharp support varies).
// A government ID is a photo or a PDF; that is all we accept.
export const ACCEPTED_MIME = ["image/jpeg", "image/png", "image/webp", "application/pdf"] as const;
export type AcceptedMime = (typeof ACCEPTED_MIME)[number];

export const MAX_EVIDENCE_BYTES = 8 * 1024 * 1024; // 8 MB

const EXTENSION: Record<AcceptedMime, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "application/pdf": "pdf",
};

/**
 * Identify a buffer by its magic bytes. The browser-supplied `file.type` and the
 * filename extension are both attacker-controlled and are never trusted — a
 * .jpg-named, image/jpeg-declared file containing `<svg onload=…>` must be
 * rejected, so we read the actual signature.
 *
 * Returns null when the content is not one of our accepted formats.
 */
export function sniffMime(buf: Buffer): AcceptedMime | null {
  if (buf.length < 12) return null;

  // JPEG: FF D8 FF
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return "image/jpeg";

  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    return "image/png";
  }

  // PDF: %PDF-
  if (buf.subarray(0, 5).toString("latin1") === "%PDF-") return "application/pdf";

  // WebP: "RIFF" .... "WEBP"
  if (
    buf.subarray(0, 4).toString("latin1") === "RIFF" &&
    buf.subarray(8, 12).toString("latin1") === "WEBP"
  ) {
    return "image/webp";
  }

  return null;
}

/**
 * A polyglot hides one format inside another (e.g. a valid PDF whose tail is
 * also a valid HTML document, so a browser renders script). We can't fully
 * defeat that, but we can reject the cheap cases: any HTML/script marker in the
 * head of the file, and SVG, which is XML and always scriptable.
 */
export function looksLikePolyglot(buf: Buffer): boolean {
  const head = buf.subarray(0, 2048).toString("latin1").toLowerCase();
  return (
    head.includes("<svg") ||
    head.includes("<!doctype html") ||
    head.includes("<html") ||
    head.includes("<script")
  );
}

export interface ValidationOk {
  ok: true;
  mime: AcceptedMime;
}
export interface ValidationFail {
  ok: false;
  /** Generic, user-safe reason. Never leaks provider or storage internals. */
  reason: string;
}

/**
 * Validate an uploaded identity document: size, true content type (magic bytes),
 * and polyglot markers. `declaredMime` is only used to fail fast — the decision
 * is always made on the bytes.
 */
export function validateEvidence(buf: Buffer, declaredMime: string): ValidationOk | ValidationFail {
  if (buf.length === 0) return { ok: false, reason: "The file is empty." };
  if (buf.length > MAX_EVIDENCE_BYTES) {
    return { ok: false, reason: "The file must be under 8 MB." };
  }
  if (!ACCEPTED_MIME.includes(declaredMime as AcceptedMime)) {
    return { ok: false, reason: "The ID must be a JPEG, PNG, WebP or PDF." };
  }

  const actual = sniffMime(buf);
  if (!actual) return { ok: false, reason: "The ID must be a JPEG, PNG, WebP or PDF." };
  if (actual !== declaredMime) {
    // Declared type disagrees with the bytes — a spoof attempt or a broken client.
    return { ok: false, reason: "The file contents don't match its type." };
  }
  if (looksLikePolyglot(buf)) {
    return { ok: false, reason: "This file type isn't accepted." };
  }
  return { ok: true, mime: actual };
}

/**
 * Strip metadata from raster images (EXIF often carries GPS coordinates and
 * device identifiers — we have no need for either, and retaining them enlarges
 * the personal-data footprint of the document).
 *
 * PDFs are passed through: re-writing a PDF risks corrupting a document a human
 * reviewer needs to read, and sharp cannot process them.
 */
export async function stripMetadata(buf: Buffer, mime: AcceptedMime): Promise<Buffer> {
  if (mime === "application/pdf") return buf;
  try {
    const sharp = (await import("sharp")).default;
    // Re-encoding without .withMetadata() drops EXIF/ICC/XMP.
    return await sharp(buf).rotate().jpeg({ quality: 90 }).toBuffer();
  } catch {
    // If sharp fails we still store the original rather than lose the upload;
    // the document is private either way.
    return buf;
  }
}

// ── Key generation ────────────────────────────────────────────────────────

/**
 * Build an opaque object key. Contains NO fighter slug, user id, email, or
 * original filename — a key must not disclose who submitted what, and must be
 * immune to path traversal because no user input reaches it.
 *
 * Randomness is defence-in-depth only: the key is never treated as a secret and
 * never used as access control. Authorization is checked on every read.
 */
export function newEvidenceKey(mime: AcceptedMime): string {
  const ext = EXTENSION[mime];
  return `evidence/${randomUUID()}-${randomBytes(8).toString("hex")}.${ext}`;
}

// ── R2 / S3 private backend ───────────────────────────────────────────────

interface R2Config {
  endpoint: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  region: string;
}

/**
 * Evidence uses its OWN bucket vars, never the public image bucket's. Sharing a
 * bucket with public fighter photos is how a passport ends up on a CDN: the
 * image bucket is fronted by R2_PUBLIC_BASE_URL and is world-readable by design.
 * A separate, private bucket makes that mistake impossible rather than merely
 * discouraged.
 */
function r2Config(): R2Config | null {
  const endpoint = process.env.EVIDENCE_R2_ENDPOINT;
  const bucket = process.env.EVIDENCE_R2_BUCKET;
  const accessKeyId = process.env.EVIDENCE_R2_ACCESS_KEY_ID;
  const secretAccessKey = process.env.EVIDENCE_R2_SECRET_ACCESS_KEY;
  if (!endpoint || !bucket || !accessKeyId || !secretAccessKey) return null;
  return { endpoint, bucket, accessKeyId, secretAccessKey, region: process.env.EVIDENCE_R2_REGION ?? "auto" };
}

// The boot-time bucket guard lives in ./config.ts, which is dependency-free so
// instrumentation.ts can import it without dragging sharp into the startup bundle.
// Re-exported here so callers of the store have one obvious import site.
export { assertPrivateBucketConfig };

async function s3Client(cfg: R2Config) {
  const mod = "@aws-sdk/client-s3";
  const s3 = (await import(/* webpackIgnore: true */ mod)) as typeof import("@aws-sdk/client-s3");
  return {
    s3,
    client: new s3.S3Client({
      region: cfg.region,
      endpoint: cfg.endpoint,
      credentials: { accessKeyId: cfg.accessKeyId, secretAccessKey: cfg.secretAccessKey },
      // Path-style addressing (endpoint/bucket/key). The SDK defaults to
      // virtual-host style (bucket.endpoint), which neither Cloudflare R2's
      // account endpoint nor an S3-compatible box like MinIO resolves.
      forcePathStyle: true,
    }),
  };
}

// ── Local private backend (dev only) ──────────────────────────────────────

function localRoot(): string {
  // NOT under public/. Next never serves this path.
  return path.resolve(process.cwd(), process.env.EVIDENCE_LOCAL_DIR ?? ".private/evidence");
}

/**
 * Resolve a key to an absolute path, refusing anything that escapes the root.
 * Keys are machine-generated so traversal shouldn't be reachable — this is the
 * belt-and-braces check that keeps it that way if a key ever comes from the DB.
 */
function localPath(key: string): string {
  const root = localRoot();
  const full = path.resolve(root, key);
  if (full !== root && !full.startsWith(root + path.sep)) {
    throw new Error("invalid storage key");
  }
  return full;
}

// ── Public API ────────────────────────────────────────────────────────────

/**
 * Persist an identity document privately. Returns the opaque key.
 *
 * In production, if no private bucket is configured this THROWS rather than
 * silently degrading to local disk — a silent fallback is how these documents
 * became public in the first place.
 */
export async function putEvidence(body: Buffer, mime: AcceptedMime): Promise<StoredEvidence> {
  assertPrivateBucketConfig();
  const key = newEvidenceKey(mime);
  const cfg = r2Config();

  if (cfg) {
    const { s3, client } = await s3Client(cfg);
    await client.send(
      new s3.PutObjectCommand({
        Bucket: cfg.bucket,
        Key: key,
        Body: body,
        ContentType: mime,
        // No ACL — R2 buckets are private unless explicitly published, and we
        // assert above that this one has no public base URL.
        //
        // No explicit ServerSideEncryption header: R2 (and S3, and MinIO) encrypt
        // at rest by default, and sending AES256 to a bucket without KMS makes the
        // PUT fail outright — i.e. asking for encryption that is already there
        // would break the upload. Transit is TLS via the https endpoint.
      }),
    );
    return { storageKey: key, provider: "r2", byteSize: body.length, contentType: mime };
  }

  if (isProd()) {
    throw new Error(
      "No private evidence bucket configured (EVIDENCE_R2_*). Refusing to store an identity " +
        "document on local disk in production.",
    );
  }

  const full = localPath(key);
  await fs.mkdir(path.dirname(full), { recursive: true });
  await fs.writeFile(full, body, { mode: 0o600 });
  return { storageKey: key, provider: "local-private", byteSize: body.length, contentType: mime };
}

/**
 * Read a document's bytes. Callers MUST have already performed authorization —
 * this function intentionally has no notion of "who is asking".
 */
export async function getEvidenceBytes(
  key: string,
  provider: string | null,
): Promise<{ body: Buffer; contentType: string } | null> {
  try {
    if (provider === "r2") {
      const cfg = r2Config();
      if (!cfg) return null;
      const { s3, client } = await s3Client(cfg);
      const res = await client.send(new s3.GetObjectCommand({ Bucket: cfg.bucket, Key: key }));
      if (!res.Body) return null;
      const bytes = await res.Body.transformToByteArray();
      return { body: Buffer.from(bytes), contentType: res.ContentType ?? "application/octet-stream" };
    }

    const full = localPath(key);
    const body = await fs.readFile(full);
    const ext = path.extname(full).slice(1);
    const contentType =
      ext === "pdf" ? "application/pdf" : ext === "png" ? "image/png" : ext === "webp" ? "image/webp" : "image/jpeg";
    return { body, contentType };
  } catch {
    // Never surface provider errors or keys to callers.
    return null;
  }
}

export type DeleteOutcome = "DELETED" | "ALREADY_ABSENT" | "FAILED";

/**
 * Delete the underlying object. Distinguishes "gone" from "failed" so the caller
 * can retry genuine failures without retrying objects that were never there —
 * nulling a database column is NOT deletion, and this is the function that makes
 * the difference real.
 */
export async function deleteEvidence(key: string, provider: string | null): Promise<DeleteOutcome> {
  try {
    if (provider === "r2") {
      const cfg = r2Config();
      if (!cfg) return "FAILED";
      const { s3, client } = await s3Client(cfg);
      await client.send(new s3.DeleteObjectCommand({ Bucket: cfg.bucket, Key: key }));
      // S3/R2 DeleteObject is idempotent — it succeeds whether or not the key
      // existed, which is exactly the semantics we want for a retryable cleanup.
      return "DELETED";
    }

    const full = localPath(key);
    try {
      await fs.unlink(full);
      return "DELETED";
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "ENOENT") return "ALREADY_ABSENT";
      throw e;
    }
  } catch (e) {
    // Log without the key — a key in logs is a durable pointer to a passport.
    log.warn({ provider, err: (e as Error).message }, "evidence:delete-failed");
    return "FAILED";
  }
}
