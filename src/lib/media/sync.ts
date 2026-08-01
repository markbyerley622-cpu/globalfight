// ════════════════════════════════════════════════════════════════════════
//  Media sync — decide, fetch conditionally, store, record provenance.
//
//  PURE OF PRISMA. Everything the database supplies arrives as MediaSubject and
//  everything it must write leaves as MediaWrite, so the whole decision path is
//  testable with no network and no database.
// ════════════════════════════════════════════════════════════════════════

import { fetchImageConditional, type HttpFetch } from "./fetch";
import {
  emptyReport, mayReplace,
  type MediaOutcome, type MediaProvider, type MediaReport, type MediaSubject,
} from "./types";

/** Days before a fighter with no image anywhere is asked again. */
export const MISS_RETRY_DAYS = 30;

export interface MediaWrite {
  subjectId: string;
  outcome: MediaOutcome;
  /** Processed own-storage bytes to persist. Absent unless outcome is "downloaded". */
  stored?: {
    buffer: Buffer;
    slug: string;
    tier: string;
    source: string;
    sourceUrl: string;
    etag: string | null;
    lastModified: string | null;
    contentHash: string;
    mimeType: string;
    bytes: number;
  };
  /** Provenance-only touch: a 304 or an identical hash still refreshes fetchedAt. */
  touchedAt?: Date;
  missing?: { at: Date; reason: string };
}

export interface MediaSyncOpts {
  subjects: MediaSubject[];
  providers: MediaProvider[];
  http?: HttpFetch;
  now?: Date;
  /** Ignore the miss backoff — for a deliberate re-attempt. */
  force?: boolean;
  /**
   * Pause between subjects, in ms.
   *
   * The image fetcher goes straight to the CDN rather than through
   * scraper/http.ts, so it does not inherit that module's global throttle — and a
   * backfill is thousands of requests. This keeps the same honest-client posture:
   * identifying UA, unhurried, no burst. Tests pass 0.
   */
  delayMs?: number;
  onProgress?: (line: string) => void;
  /**
   * Persist ONE subject, called the instant its outcome is known.
   *
   * This exists because the alternative does not survive a crash. Collecting
   * every write and committing at the end means a run killed at fighter 900 of
   * 1,300 discards all 900 — nothing is corrupted, but the bytes were transferred
   * for nothing and the next run re-fetches them. Every loop iteration has to be
   * independently durable, so persistence happens here, inline, per subject.
   *
   * A throw is caught and recorded as a STORAGE failure, kept distinct from a
   * fetch failure: they have different causes and different fixes.
   */
  onSubjectDone?: (write: MediaWrite) => Promise<void>;
}

export interface MediaSyncResult {
  writes: MediaWrite[];
  report: MediaReport;
}

/** Is this subject due, given a previous miss? */
export function isDueForRetry(missingAt: Date | null, now: Date, force = false): boolean {
  if (force || !missingAt) return true;
  return now.getTime() - missingAt.getTime() >= MISS_RETRY_DAYS * 86_400_000;
}

export async function syncMedia(opts: MediaSyncOpts): Promise<MediaSyncResult> {
  const now = opts.now ?? new Date();
  const say = opts.onProgress ?? (() => {});
  const report = emptyReport();
  const writes: MediaWrite[] = [];

  /**
   * Record an outcome AND persist it before moving on. Awaited on purpose: the
   * next subject must not start until this one is durable.
   */
  const record = async (subjectId: string, outcome: MediaOutcome, extra: Partial<MediaWrite> = {}) => {
    const write: MediaWrite = { subjectId, outcome, ...extra };
    writes.push(write);
    if (opts.onSubjectDone) {
      try {
        await opts.onSubjectDone(write);
      } catch (e) {
        // The bytes arrived and could not be stored. That is a STORAGE failure,
        // not a source gap and not a fetch failure — reported as its own thing so
        // nobody goes looking at ESPN for it.
        report.byOutcome["storage-failed"] += 1;
        report.failures.push({ subject: subjectId, reason: `storage: ${(e as Error).message}` });
        return;
      }
    }
    report.byOutcome[outcome] += 1;
  };

  for (const subject of opts.subjects) {
    report.considered += 1;

    // Providers are ordered best-first; take the first that has anything AND
    // that is allowed to replace what we already hold.
    let chosen: { provider: MediaProvider; url: string } | null = null;
    let sawCandidate = false;
    for (const provider of opts.providers) {
      const candidate = provider.candidateFor(subject);
      if (!candidate) continue;
      sawCandidate = true;
      if (!mayReplace(subject.held.tier, candidate.tier)) continue;
      chosen = { provider, url: candidate.url };
      break;
    }

    if (!chosen) {
      // Distinguish "nobody has one" from "we already hold something better".
      await record(subject.id,sawCandidate ? "skipped-better" : "no-candidate");
      continue;
    }

    const missingAt = (subject as MediaSubject & { missingAt?: Date | null }).missingAt ?? null;
    if (!isDueForRetry(missingAt, now, opts.force)) {
      await record(subject.id,"skipped-backoff");
      continue;
    }

    if (opts.delayMs && opts.delayMs > 0) await new Promise((r) => setTimeout(r, opts.delayMs));
    const result = await fetchImageConditional(chosen.url, subject.held, opts.http);

    if (result.kind === "not-modified") {
      await record(subject.id,"unchanged-304", { touchedAt: now });
      continue;
    }
    if (result.kind === "missing") {
      await record(subject.id,"missing-404", {
        missing: { at: now, reason: `${chosen.provider.key} HTTP ${result.status}` },
      });
      continue;
    }
    if (result.kind === "failed") {
      report.failures.push({ subject: subject.name, reason: result.reason });
      await record(subject.id, "failed");
      continue;
    }

    // Bytes came back. If they hash to what we already stored, the server simply
    // does not support conditional GETs well — do not re-process or re-store.
    if (subject.held.contentHash && subject.held.contentHash === result.contentHash) {
      await record(subject.id,"unchanged-hash", { touchedAt: now });
      continue;
    }

    report.bytesDownloaded += result.bytes;
    await record(subject.id, "downloaded", {
      stored: {
        buffer: result.buffer,
        slug: subject.slug,
        tier: chosen.provider.tier,
        source: chosen.provider.key,
        sourceUrl: chosen.url,
        etag: result.etag,
        lastModified: result.lastModified,
        contentHash: result.contentHash,
        mimeType: result.mimeType,
        bytes: result.bytes,
      },
    });
    say(`   + ${subject.name} — ${(result.bytes / 1024).toFixed(0)}KB from ${chosen.provider.key}`);
  }

  return { writes, report };
}
