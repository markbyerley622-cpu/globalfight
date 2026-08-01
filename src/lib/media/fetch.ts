// ════════════════════════════════════════════════════════════════════════
//  Conditional image fetch. The part that makes refreshes cheap and idempotent.
//
//  Sends If-None-Match / If-Modified-Since from what we already hold, so a
//  weekly refresh over thousands of fighters transfers almost nothing: the
//  server answers 304 and we touch nothing but a timestamp.
//
//  Verified against ESPN's CDN, which returns both a strong ETag and
//  Last-Modified on every headshot.
// ════════════════════════════════════════════════════════════════════════

import { createHash } from "node:crypto";
import { BOT_USER_AGENT } from "@/lib/http-identity";
import type { HeldMedia } from "./types";

export interface FetchedImage {
  kind: "bytes";
  buffer: Buffer;
  etag: string | null;
  lastModified: string | null;
  mimeType: string;
  /** sha256 of the SOURCE bytes — the idempotency key across providers. */
  contentHash: string;
  bytes: number;
}

export type ImageFetchResult =
  | FetchedImage
  | { kind: "not-modified" }
  | { kind: "missing"; status: number }
  | { kind: "failed"; reason: string };

/** Injectable so tests exercise every branch without network. */
export type HttpFetch = (url: string, init: { headers: Record<string, string> }) => Promise<{
  status: number;
  headers: { get(name: string): string | null };
  arrayBuffer(): Promise<ArrayBuffer>;
}>;

export const sha256 = (b: Buffer): string => createHash("sha256").update(b).digest("hex");

export async function fetchImageConditional(
  url: string,
  held: HeldMedia,
  http: HttpFetch = globalThis.fetch as unknown as HttpFetch,
): Promise<ImageFetchResult> {
  const headers: Record<string, string> = { "user-agent": BOT_USER_AGENT, accept: "image/*" };
  // Only send validators when we actually hold the bytes they describe. Sending
  // an ETag for an image we no longer have would earn a 304 and leave the
  // fighter with no image at all.
  if (held.contentHash) {
    if (held.etag) headers["if-none-match"] = held.etag;
    if (held.lastModified) headers["if-modified-since"] = held.lastModified;
  }

  let resp: Awaited<ReturnType<HttpFetch>>;
  try {
    resp = await http(url, { headers });
  } catch (e) {
    return { kind: "failed", reason: (e as Error).message };
  }

  if (resp.status === 304) return { kind: "not-modified" };
  // 404/410 mean the provider published a URL that does not resolve. That is a
  // MISSING image, not a failure — it is recorded and backed off, not retried
  // tomorrow.
  if (resp.status === 404 || resp.status === 410) return { kind: "missing", status: resp.status };
  if (resp.status < 200 || resp.status >= 300) return { kind: "failed", reason: `HTTP ${resp.status}` };

  const mimeType = (resp.headers.get("content-type") ?? "").split(";")[0].trim();
  if (!mimeType.startsWith("image/")) {
    // ESPN answers a missing headshot with a 1-byte text/html body and a 200.
    // Trusting the status alone stores that as an image and the fighter gets a
    // broken picture instead of a recorded miss.
    return { kind: "missing", status: resp.status };
  }

  const buffer = Buffer.from(await resp.arrayBuffer());
  if (buffer.byteLength === 0) return { kind: "missing", status: resp.status };

  return {
    kind: "bytes",
    buffer,
    etag: resp.headers.get("etag"),
    lastModified: resp.headers.get("last-modified"),
    mimeType,
    contentHash: sha256(buffer),
    bytes: buffer.byteLength,
  };
}
