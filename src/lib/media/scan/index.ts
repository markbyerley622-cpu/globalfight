import "server-only";
import { getScanProvider } from "./providers";
import { validateImageBytes, type ValidationFail } from "./validate";
import { isPublishable, isRetryable, type MediaScanResult } from "./types";

export * from "./types";
export * from "./validate";
export { getScanProvider, __setScanProvider, MockScanProvider, HttpScanProvider, NullScanProvider } from "./providers";

// ════════════════════════════════════════════════════════════════════════════
//  THE GATE. One function decides whether bytes may ever become public.
//
//  ── Order matters, and this is the order ─────────────────────────────────
//    1. VALIDATE structurally — cheap, local, and keeps obviously-hostile
//       bytes out of temporary storage and away from the scanner entirely.
//    2. SCAN — network, expensive, retried.
//    3. Publish only on SAFE.
//
//  Reversing 1 and 2 would ship every probe and every 12MB of garbage to the
//  scanning service, and would put unvalidated bytes through an image decoder,
//  which is itself a CVE surface.
//
//  ── FAIL CLOSED, stated once, here ───────────────────────────────────────
//  Anything that is not an explicit SAFE is a refusal. Not a warning, not a
//  "publish and flag for review", not a "the scanner is down so let it
//  through". The evidence pipeline can afford a SKIPPED state because a human
//  reviews every document and none of them are public; media has neither
//  protection, so the only safe default is no.
// ════════════════════════════════════════════════════════════════════════════

export type MediaGateOutcome =
  | { ok: true; mime: string; bytes: number; sha256: string; scan: MediaScanResult }
  | { ok: false; stage: "validation"; reason: ValidationFail["reason"]; message: string }
  | { ok: false; stage: "scan"; scan: MediaScanResult; message: string };

/** How many times a retryable verdict is re-attempted before giving up. */
const MAX_ATTEMPTS = Number(process.env.MEDIA_SCAN_ATTEMPTS) || 2;

/**
 * What the UPLOADER is told, per verdict.
 *
 * Deliberately vague about the reason. "Infected" tells someone probing the
 * pipeline that their payload was detected, which is precisely the feedback
 * loop that lets them iterate until it is not. The real verdict goes to the
 * audit trail and the logs, where it is authenticated.
 */
const MESSAGE: Record<MediaScanResult["verdict"], string> = {
  SAFE: "",
  INFECTED: "That file couldn't be accepted.",
  FAILED: "We couldn't check that file right now. Please try again shortly.",
  TIMEOUT: "We couldn't check that file right now. Please try again shortly.",
  UNKNOWN: "Media uploads are temporarily unavailable. We do not publish files we cannot scan.",
};

/**
 * Run the full gate over a buffer.
 *
 * Returns a decision only — no storage, no database, no image processing. That
 * separation is what lets every future consumer (gym posts, fighter photos,
 * event posters, article covers) share one security decision without inheriting
 * one storage layout.
 */
export async function screenMedia(
  bytes: Buffer,
  declaredMime?: string | null,
): Promise<MediaGateOutcome> {
  const validation = validateImageBytes(bytes, declaredMime);
  if (!validation.ok) {
    return { ok: false, stage: "validation", reason: validation.reason, message: validation.message };
  }

  const provider = getScanProvider();
  const hint = { mime: validation.mime, bytes: validation.bytes, sha256: validation.sha256 };

  let scan: MediaScanResult | null = null;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    // The provider contract says `scan` must never throw. This ENFORCES it
    // rather than trusting it: a third-party or future provider that throws
    // would otherwise escape into the upload path, and the failure mode of a
    // scanner crash must be a refusal — never a 500 that skips the check and
    // certainly never an exception that some outer handler turns into success.
    try {
      scan = await provider.scan(bytes, hint);
    } catch (e) {
      scan = {
        verdict: "FAILED",
        provider: provider.name,
        durationMs: 0,
        detail: e instanceof Error ? e.message : "provider threw",
      };
    }
    if (!isRetryable(scan)) break;
    // No backoff between attempts on purpose: this runs inside a request, and a
    // sleep here is latency the uploader pays. A scanner that needs backoff
    // needs a queue, which is the next iteration, not a setTimeout.
  }

  // Defensive: a provider that somehow returned nothing is a refusal, never a pass.
  if (!scan) {
    return {
      ok: false,
      stage: "scan",
      scan: { verdict: "UNKNOWN", provider: provider.name, durationMs: 0 },
      message: MESSAGE.UNKNOWN,
    };
  }

  if (!isPublishable(scan)) {
    return { ok: false, stage: "scan", scan, message: MESSAGE[scan.verdict] };
  }

  return { ok: true, mime: validation.mime, bytes: validation.bytes, sha256: validation.sha256, scan };
}

/** For /api/health — never exposes the URL or the token. */
export async function scannerHealth(): Promise<{ configured: boolean; provider: string; reachable: boolean }> {
  const provider = getScanProvider();
  const configured = provider.name !== "none";
  return { configured, provider: provider.name, reachable: configured ? await provider.isReachable() : false };
}
