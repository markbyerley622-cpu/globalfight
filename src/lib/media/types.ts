// ════════════════════════════════════════════════════════════════════════
//  Media ingestion — PROVIDER-shaped, not ESPN-shaped.
//
//  ESPN headshots are the first provider, not the design. Official promotion
//  artwork, Wikimedia Commons and manual uploads all supply the same thing — a
//  candidate image with a provenance story — so they implement one interface and
//  the pipeline stays the same when Misfits or Karate Combat are plugged in.
// ════════════════════════════════════════════════════════════════════════

/**
 * Image quality tiers, best first.
 *
 * The ordering IS the safety rule: a lower tier may never replace a higher one.
 * A fighter who uploaded their own photo, or whose promotion supplied official
 * artwork, must never be silently downgraded to a 200px ESPN headshot by a cron.
 */
export const TIERS = ["manual", "official", "wikimedia", "espn"] as const;
export type MediaTier = (typeof TIERS)[number];

/** Lower rank = better. Unknown tiers sort last, so they never win by accident. */
export function tierRank(tier: string | null | undefined): number {
  const i = TIERS.indexOf(tier as MediaTier);
  return i < 0 ? TIERS.length : i;
}

/**
 * May `incoming` replace `held`?
 *
 * Strictly better only. Equal tiers are allowed through so the SAME provider can
 * refresh its own image (a fighter's ESPN headshot being updated), but a
 * different, worse provider cannot.
 */
export function mayReplace(held: string | null | undefined, incoming: MediaTier): boolean {
  if (!held) return true;
  return tierRank(incoming) <= tierRank(held);
}

/** What a provider offers for one subject, before any bytes are fetched. */
export interface MediaCandidate {
  /** Absolute URL the provider explicitly published. Never constructed by guesswork. */
  url: string;
  tier: MediaTier;
  /** Provider key, stored as Fighter.imageSource. */
  source: string;
}

/** What we already hold, so a provider run can be conditional and idempotent. */
export interface HeldMedia {
  tier: string | null;
  etag: string | null;
  lastModified: string | null;
  contentHash: string | null;
}

export interface MediaSubject {
  id: string;
  slug: string;
  name: string;
  /** Provider-scoped external id, e.g. the ESPN athlete id. */
  externalIds: Record<string, string>;
  held: HeldMedia;
}

export interface MediaProvider {
  key: string;
  tier: MediaTier;
  label: string;
  /**
   * The image this provider publishes for the subject, or null when it has none.
   *
   * MUST return only a URL the source actually references. A provider that
   * constructs a plausible-looking CDN path it has not verified is inventing
   * data, and a 404 later is not a defence.
   */
  candidateFor(subject: MediaSubject): MediaCandidate | null;
}

/** Outcome of one subject, for the run report. Every case is distinct. */
export type MediaOutcome =
  | "downloaded"      // new bytes stored
  | "unchanged-304"   // server said Not Modified — nothing transferred
  | "unchanged-hash"  // bytes came back identical; not re-processed or re-stored
  | "skipped-better"  // we hold an image from a higher tier
  | "skipped-backoff" // recently missing; not due for retry
  | "no-candidate"    // provider has nothing for this subject
  | "missing-404"     // provider published a URL that does not resolve
  | "failed"          // transport error reaching the provider
  | "storage-failed"; // bytes arrived, we could not store them — OURS, not the source's

export interface MediaReport {
  considered: number;
  byOutcome: Record<MediaOutcome, number>;
  /** Bytes actually transferred — the number conditional GETs exist to shrink. */
  bytesDownloaded: number;
  failures: { subject: string; reason: string }[];
}

export const emptyReport = (): MediaReport => ({
  considered: 0,
  byOutcome: {
    downloaded: 0, "unchanged-304": 0, "unchanged-hash": 0, "skipped-better": 0,
    "skipped-backoff": 0, "no-candidate": 0, "missing-404": 0, failed: 0, "storage-failed": 0,
  },
  bytesDownloaded: 0,
  failures: [],
});
