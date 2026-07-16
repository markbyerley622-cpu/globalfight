// ════════════════════════════════════════════════════════════════════════
//  Clip video storage. Mirrors the image pipeline's backend selection but for
//  arbitrary content types (video/mp4, video/webm) — no resizing/transcoding.
//    • Cloudflare R2 / S3  — when R2_* (or S3_*) env vars are set (preferred).
//    • Vercel Blob         — when BLOB_READ_WRITE_TOKEN is set.
//    • Local disk          — public/<key> (dev fallback).
//  Returns the public URL of the stored object.
// ════════════════════════════════════════════════════════════════════════

import "server-only";
import { promises as fs } from "node:fs";
import path from "node:path";

async function putR2(key: string, body: Buffer, contentType: string): Promise<string | null> {
  const endpoint = process.env.R2_ENDPOINT ?? process.env.S3_ENDPOINT;
  const bucket = process.env.R2_BUCKET ?? process.env.S3_BUCKET;
  const accessKeyId = process.env.R2_ACCESS_KEY_ID ?? process.env.S3_ACCESS_KEY_ID;
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY ?? process.env.S3_SECRET_ACCESS_KEY;
  const publicBase = process.env.R2_PUBLIC_BASE_URL ?? process.env.S3_PUBLIC_BASE_URL;
  if (!endpoint || !bucket || !accessKeyId || !secretAccessKey || !publicBase) return null;

  const { S3Client, PutObjectCommand } = await import("@aws-sdk/client-s3");
  const client = new S3Client({
    region: process.env.R2_REGION ?? "auto",
    endpoint,
    credentials: { accessKeyId, secretAccessKey },
  });
  await client.send(new PutObjectCommand({ Bucket: bucket, Key: key, Body: body, ContentType: contentType }));
  return `${publicBase.replace(/\/$/, "")}/${key}`;
}

async function putBlob(key: string, body: Buffer, contentType: string): Promise<string | null> {
  if (!process.env.BLOB_READ_WRITE_TOKEN) return null;
  const mod = "@vercel/blob";
  const blob = (await import(/* webpackIgnore: true */ mod).catch(() => null)) as
    | { put: (k: string, b: Buffer, o: Record<string, unknown>) => Promise<{ url: string }> }
    | null;
  if (!blob) return null;
  const res = await blob.put(key, body, {
    access: "public", contentType,
    token: process.env.BLOB_READ_WRITE_TOKEN, addRandomSuffix: false, allowOverwrite: true,
  });
  return res.url;
}

async function putLocal(key: string, body: Buffer): Promise<string> {
  const full = path.join(process.cwd(), "public", key);
  await fs.mkdir(path.dirname(full), { recursive: true });
  await fs.writeFile(full, body);
  return `/${key}`;
}

/** True when a durable (non-local) storage backend is configured. */
export function hasDurableStorage(): boolean {
  return !!(process.env.R2_ENDPOINT || process.env.S3_ENDPOINT || process.env.BLOB_READ_WRITE_TOKEN);
}

/** Store a video buffer and return its public URL. Prefers R2, then Blob, then disk. */
export async function storeClipVideo(key: string, body: Buffer, contentType: string): Promise<string> {
  const r2 = await putR2(key, body, contentType).catch(() => null);
  if (r2) return r2;
  const blob = await putBlob(key, body, contentType).catch(() => null);
  if (blob) return blob;
  return putLocal(key, body);
}
