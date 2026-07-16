// ════════════════════════════════════════════════════════════════════════
//  Cloudflare Stream — transcodes any uploaded video into adaptive HLS and
//  generates a poster thumbnail, so clips play (and autoplay) reliably on every
//  device regardless of the source format (e.g. iPhone .mov/HEVC).
//
//  Flow: server requests a one-time direct-upload URL → the client uploads the
//  file straight to Cloudflare (offloading the big transfer from our server) →
//  we store the returned video UID and serve its HLS manifest + thumbnail.
//
//  Configured via CF_STREAM_ACCOUNT_ID, CF_STREAM_API_TOKEN, CF_STREAM_DOMAIN.
//  When unset, the uploader falls back to the direct-to-R2 raw-file path.
// ════════════════════════════════════════════════════════════════════════

import "server-only";

export function hasStream(): boolean {
  return !!(process.env.CF_STREAM_ACCOUNT_ID && process.env.CF_STREAM_API_TOKEN && process.env.CF_STREAM_DOMAIN);
}

/** Ask Cloudflare for a one-time upload URL the client can POST the file to. */
export async function createStreamDirectUpload(maxDurationSeconds = 600): Promise<{ uploadURL: string; uid: string }> {
  const acct = process.env.CF_STREAM_ACCOUNT_ID;
  const token = process.env.CF_STREAM_API_TOKEN;
  if (!acct || !token) throw new Error("Cloudflare Stream is not configured.");
  const res = await fetch(`https://api.cloudflare.com/client/v4/accounts/${acct}/stream/direct_upload`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify({ maxDurationSeconds, requireSignedURLs: false }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data?.success || !data?.result?.uploadURL) {
    throw new Error(data?.errors?.[0]?.message ?? "Could not start the upload.");
  }
  return { uploadURL: data.result.uploadURL as string, uid: data.result.uid as string };
}

/** Public HLS + poster URLs for a processed Stream video. */
export function streamUrls(uid: string): { videoUrl: string; posterUrl: string } {
  const domain = (process.env.CF_STREAM_DOMAIN ?? "").replace(/^https?:\/\//, "").replace(/\/$/, "");
  return {
    videoUrl: `https://${domain}/${uid}/manifest/video.m3u8`,
    posterUrl: `https://${domain}/${uid}/thumbnails/thumbnail.jpg?time=1s&height=1200`,
  };
}
