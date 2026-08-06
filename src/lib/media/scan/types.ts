// ════════════════════════════════════════════════════════════════════════════
//  THE SCANNER CONTRACT — provider-agnostic, and deliberately not ClamAV.
//
//  ── Why an abstraction rather than "wire up ClamAV" ──────────────────────
//  A ClamAV sidecar is the obvious first implementation and probably the right
//  one today. It is also an operational commitment — a container to run, a
//  signature database to keep current, memory to budget — and the decision that
//  is most likely to change once traffic is real. Coupling the upload path to it
//  means the day you move to a cloud scanner you are editing the upload path,
//  which is the one piece of code you least want to touch under time pressure.
//
//  So the upload path depends on THIS interface. Providers are swappable and
//  none of them can change the lifecycle.
//
//  ── Why these five verdicts ──────────────────────────────────────────────
//  The existing evidence scanner returns CLEAN | INFECTED | SKIPPED, which is
//  correct for its job: identity documents are never public and a human reviews
//  every one, so "we could not scan it" is a state a reviewer can safely be
//  shown. PUBLIC media has no such reviewer. The difference between "the
//  scanner said clean" and "the scanner was down" has to survive into the
//  lifecycle, because one may be published and the other must never be.
//
//  Hence FAILED / TIMEOUT / UNKNOWN are distinct rather than collapsed:
//    FAILED  — the provider ran and errored. Retryable.
//    TIMEOUT — the provider did not answer in time. Retryable, but a distinct
//              signal: a scanner that times out under load is a capacity
//              problem, not a bug, and merging it into FAILED hides that.
//    UNKNOWN — no provider is configured, or it returned something we do not
//              understand. NOT retryable; it is a configuration fault.
//
//  Only SAFE may be published. Every other verdict fails closed.
// ════════════════════════════════════════════════════════════════════════════

export type MediaScanVerdict = "SAFE" | "INFECTED" | "FAILED" | "TIMEOUT" | "UNKNOWN";

export interface MediaScanResult {
  verdict: MediaScanVerdict;
  /** Which provider produced this, for the audit trail. */
  provider: string;
  /** Wall-clock cost, so a slow scanner is visible before it becomes an outage. */
  durationMs: number;
  /**
   * The threat name when a provider supplies one (ClamAV returns e.g.
   * "Eicar-Test-Signature"). Recorded for the audit trail; NEVER shown to the
   * uploader, who does not need to know which signature matched.
   */
  signature?: string | null;
  /** Operator-facing detail. Never returned to a client. */
  detail?: string | null;
}

export interface MediaScanProvider {
  /** Stable identifier, stored on the asset. */
  readonly name: string;
  /**
   * Is this provider usable right now? Drives /api/health and lets the
   * lifecycle refuse an upload up front rather than after the bytes are stored.
   * Must never throw.
   */
  isReachable(): Promise<boolean>;
  /**
   * Scan the bytes. Must never throw — a provider that throws would let an
   * exception escape into the upload path, and the failure mode of a scanner
   * crash must be a refusal, not a 500 that skips the check.
   */
  scan(bytes: Buffer, hint: ScanHint): Promise<MediaScanResult>;
}

/** What the provider is being asked to scan. Never a client-supplied filename. */
export interface ScanHint {
  /** MIME as determined by SIGNATURE sniffing, never the declared header. */
  mime: string;
  bytes: number;
  /** SHA-256 of the content, for provider-side caching and dedupe. */
  sha256: string;
}

/** Only this verdict may ever reach public storage. */
export const isPublishable = (r: MediaScanResult): boolean => r.verdict === "SAFE";

/**
 * Should the lifecycle try again?
 *
 * UNKNOWN is deliberately NOT retryable: retrying an unconfigured scanner just
 * burns the retry budget and delays the operator finding out. It is a
 * configuration fault and should surface immediately.
 */
export const isRetryable = (r: MediaScanResult): boolean =>
  r.verdict === "FAILED" || r.verdict === "TIMEOUT";
