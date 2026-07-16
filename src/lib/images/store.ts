// ════════════════════════════════════════════════════════════════════════
//  Image pipeline — process → cache. We NEVER hotlink an external image URL;
//  every source image is fetched/uploaded once, resized into WebP variants,
//  and stored on our own infrastructure.
//
//  Two shapes:
//    • Fighter avatars      → three fixed cover-fit squares/16:9 (thumb/profile/hero).
//    • Forum / event / gym  → aspect-preserving `full` + `thumb` (feed media).
//
//  Storage backend (auto-detected, same for both):
//    • Vercel Blob  — when BLOB_READ_WRITE_TOKEN is set (production).
//    • Cloudflare R2 / S3 — when R2_* (or S3_*) env vars are set (S3-compatible).
//    • Local disk   — public/<key> (dev fallback, served statically by Next).
//
//  processAndStore() returns null on failure so callers keep a placeholder;
//  the *Buffer variants rethrow so upload endpoints can surface a real error.
// ════════════════════════════════════════════════════════════════════════

import { promises as fs } from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { log } from "@/lib/scraper/logger";

export type Variant = "thumb" | "profile" | "hero";

// Square thumb/profile; 16:9 hero. cover-fit, biased to the top (faces/heads).
const SPECS: Record<Variant, { w: number; h: number }> = {
  thumb: { w: 160, h: 160 },
  profile: { w: 512, h: 512 },
  hero: { w: 1280, h: 720 },
};

export interface StoredImages {
  thumbUrl: string;
  imageUrl: string;
  heroImageUrl: string;
}

const UA = "CombatRegisterBot/2.0 (+https://combat-register.vercel.app/bot)";

async function downloadImage(url: string): Promise<Buffer> {
  const resp = await fetch(url, { headers: { "user-agent": UA } });
  if (!resp.ok) throw new Error(`image fetch ${resp.status} for ${url}`);
  const type = resp.headers.get("content-type") ?? "";
  if (!type.startsWith("image/")) throw new Error(`not an image (${type}) for ${url}`);
  return Buffer.from(await resp.arrayBuffer());
}

async function render(src: Buffer, v: Variant): Promise<Buffer> {
  const { w, h } = SPECS[v];
  return sharp(src)
    .resize(w, h, { fit: "cover", position: "top" })
    .webp({ quality: 82 })
    .toBuffer();
}

// ─── Backends ───────────────────────────────────────────────────────────

async function putBlob(key: string, body: Buffer, contentType = "image/webp"): Promise<string | null> {
  if (!process.env.BLOB_READ_WRITE_TOKEN) return null;
  const mod = "@vercel/blob";
  const blob = (await import(/* webpackIgnore: true */ mod).catch(() => null)) as
    | { put: (k: string, b: Buffer, o: Record<string, unknown>) => Promise<{ url: string }> }
    | null;
  if (!blob) {
    log.warn({}, "images:blob-token-set-but-package-missing — run `npm i @vercel/blob`");
    return null;
  }
  const res = await blob.put(key, body, {
    access: "public",
    contentType,
    token: process.env.BLOB_READ_WRITE_TOKEN,
    addRandomSuffix: false,
    allowOverwrite: true,
  });
  return res.url;
}

// Cloudflare R2 / any S3-compatible bucket. Lazy-imports the AWS SDK so the
// dependency is only needed when R2/S3 is actually configured.
async function putR2(key: string, body: Buffer, contentType = "image/webp"): Promise<string | null> {
  const endpoint = process.env.R2_ENDPOINT ?? process.env.S3_ENDPOINT;
  const bucket = process.env.R2_BUCKET ?? process.env.S3_BUCKET;
  const accessKeyId = process.env.R2_ACCESS_KEY_ID ?? process.env.S3_ACCESS_KEY_ID;
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY ?? process.env.S3_SECRET_ACCESS_KEY;
  const publicBase = process.env.R2_PUBLIC_BASE_URL ?? process.env.S3_PUBLIC_BASE_URL;
  if (!endpoint || !bucket || !accessKeyId || !secretAccessKey || !publicBase) return null;

  const mod = "@aws-sdk/client-s3";
  const s3 = (await import(/* webpackIgnore: true */ mod).catch(() => null)) as
    | { S3Client: new (c: unknown) => unknown; PutObjectCommand: new (c: unknown) => unknown }
    | null;
  if (!s3) {
    log.warn({}, "images:r2-configured-but-package-missing — run `npm i @aws-sdk/client-s3`");
    return null;
  }
  const client = new s3.S3Client({
    region: process.env.R2_REGION ?? "auto",
    endpoint,
    credentials: { accessKeyId, secretAccessKey },
  }) as { send: (c: unknown) => Promise<unknown> };
  await client.send(new s3.PutObjectCommand({ Bucket: bucket, Key: key, Body: body, ContentType: contentType }));
  return `${publicBase.replace(/\/$/, "")}/${key}`;
}

async function putLocalKey(key: string, body: Buffer): Promise<string> {
  const full = path.join(process.cwd(), "public", key);
  await fs.mkdir(path.dirname(full), { recursive: true });
  await fs.writeFile(full, body);
  return `/${key}`; // served statically by Next
}

/** Store a WebP buffer at `key` on the best configured backend. */
async function putObject(key: string, body: Buffer): Promise<string> {
  const blobUrl = await putBlob(key, body).catch(() => null);
  if (blobUrl) return blobUrl;
  const r2Url = await putR2(key, body).catch(() => null);
  if (r2Url) return r2Url;
  return putLocalKey(key, body);
}

// storeRaw() used to live here: it stored arbitrary bytes — including fighter ID
// documents — on a PUBLIC backend and returned a permanent public URL. It has been
// removed rather than left unused, so it cannot be reached for again.
//
// Identity documents now go through src/lib/evidence/store.ts, which is private by
// construction. This module is for images that are MEANT to be public.

/**
 * Delete a stored file given its public URL, on whichever backend it lives on
 * (Vercel Blob → R2/S3 → local disk). Best-effort: returns true if a delete was
 * attempted on one of our backends, false if the URL isn't ours (external host
 * we can't and shouldn't touch). Never throws.
 */
export async function deleteStored(url: string): Promise<boolean> {
  try {
    // Vercel Blob
    if (process.env.BLOB_READ_WRITE_TOKEN && /\.public\.blob\.vercel-storage\.com\//.test(url)) {
      const mod = "@vercel/blob";
      const blob = (await import(/* webpackIgnore: true */ mod).catch(() => null)) as
        | { del: (u: string, o: Record<string, unknown>) => Promise<void> }
        | null;
      if (blob) { await blob.del(url, { token: process.env.BLOB_READ_WRITE_TOKEN }); return true; }
    }

    // Cloudflare R2 / S3 (URL under our public base)
    const publicBase = (process.env.R2_PUBLIC_BASE_URL ?? process.env.S3_PUBLIC_BASE_URL ?? "").replace(/\/$/, "");
    if (publicBase && url.startsWith(publicBase + "/")) {
      const key = decodeURIComponent(url.slice(publicBase.length + 1));
      const bucket = process.env.R2_BUCKET ?? process.env.S3_BUCKET;
      const accessKeyId = process.env.R2_ACCESS_KEY_ID ?? process.env.S3_ACCESS_KEY_ID;
      const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY ?? process.env.S3_SECRET_ACCESS_KEY;
      const endpoint = process.env.R2_ENDPOINT ?? process.env.S3_ENDPOINT;
      if (bucket && accessKeyId && secretAccessKey) {
        const mod = "@aws-sdk/client-s3";
        const s3 = (await import(/* webpackIgnore: true */ mod).catch(() => null)) as
          | { S3Client: new (c: unknown) => { send: (c: unknown) => Promise<unknown> }; DeleteObjectCommand: new (c: unknown) => unknown }
          | null;
        if (s3) {
          const client = new s3.S3Client({ region: process.env.R2_REGION ?? "auto", endpoint, credentials: { accessKeyId, secretAccessKey } });
          await client.send(new s3.DeleteObjectCommand({ Bucket: bucket, Key: key }));
          return true;
        }
      }
    }

    // Local public file (served statically): "/fighters/…"
    if (url.startsWith("/")) {
      await fs.unlink(path.join(process.cwd(), "public", url.replace(/^\//, ""))).catch(() => {});
      return true;
    }
  } catch (e) {
    log.warn({ url, err: (e as Error).message }, "deleteStored failed");
  }
  return false;
}

async function store(slug: string, variant: Variant, body: Buffer): Promise<string> {
  return putObject(`fighters/${slug}/${variant}.webp`, body);
}

/** Resize a source buffer into all three variants and store them. */
async function processBuffer(slug: string, src: Buffer): Promise<StoredImages> {
  const [thumb, profile, hero] = await Promise.all([
    render(src, "thumb"),
    render(src, "profile"),
    render(src, "hero"),
  ]);
  const [thumbUrl, imageUrl, heroImageUrl] = await Promise.all([
    store(slug, "thumb", thumb),
    store(slug, "profile", profile),
    store(slug, "hero", hero),
  ]);
  return { thumbUrl, imageUrl, heroImageUrl };
}

/**
 * Download a source image and store all three cached variants for a fighter.
 * Returns the stored URLs, or null if the source couldn't be fetched/decoded.
 */
export async function processAndStore(slug: string, sourceUrl: string): Promise<StoredImages | null> {
  try {
    return await processBuffer(slug, await downloadImage(sourceUrl));
  } catch (e) {
    log.warn({ slug, err: (e as Error).message }, "images:process-failed");
    return null;
  }
}

/**
 * Process an already-in-hand image buffer (e.g. a fighter uploading their own
 * photo) into the three cached variants. Unlike processAndStore this rethrows
 * so the upload endpoint can surface a real error (bad/corrupt image) to the user.
 */
export async function processAndStoreBuffer(slug: string, buffer: Buffer): Promise<StoredImages> {
  return processBuffer(slug, buffer);
}

// ─── Content images (forum posts, event posters, gym photos) ──────────────

export interface StoredContentImage {
  url: string;       // full-size, aspect-preserved (max 1600px on the long edge)
  thumbUrl: string;  // lazy-load thumbnail (max 600px on the long edge)
  width: number;     // intrinsic dimensions of the full image (for layout)
  height: number;
}

/**
 * Process an uploaded content image into a full + thumbnail WebP pair, keeping
 * the original aspect ratio (unlike avatars, which are cover-cropped). Stored
 * under `<prefix>/<id>/{full,thumb}.webp`. Used by forum/event/gym uploads.
 */
export async function processAndStoreContentImage(
  prefix: string, id: string, src: Buffer,
): Promise<StoredContentImage> {
  const meta = await sharp(src).metadata();

  const full = await sharp(src).rotate() // honour EXIF orientation
    .resize({ width: 1600, height: 1600, fit: "inside", withoutEnlargement: true })
    .webp({ quality: 82 })
    .toBuffer();
  const thumb = await sharp(src).rotate()
    .resize({ width: 600, height: 600, fit: "inside", withoutEnlargement: true })
    .webp({ quality: 78 })
    .toBuffer();

  // Recover the stored full dimensions (post-rotate/resize) for layout.
  const fullMeta = await sharp(full).metadata();
  const key = `${prefix}/${id}`;
  const [url, thumbUrl] = await Promise.all([
    putObject(`${key}/full.webp`, full),
    putObject(`${key}/thumb.webp`, thumb),
  ]);
  return {
    url,
    thumbUrl,
    width: fullMeta.width ?? meta.width ?? 0,
    height: fullMeta.height ?? meta.height ?? 0,
  };
}
