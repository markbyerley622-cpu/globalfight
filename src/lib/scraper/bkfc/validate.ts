// ════════════════════════════════════════════════════════════════════════
//  BKFC provider — validation & data-quality gate.
//
//  Structural checks (zod) + semantic checks (impossible records, absurd
//  dates, missing identity). A record that fails a HARD check is rejected and
//  never persisted; soft issues are returned as warnings for the run log.
// ════════════════════════════════════════════════════════════════════════

import { z } from "zod";
import type { BkfcEvent, BkfcFighter, BkfcRankingRow, BkfcArticle } from "./types";

export interface Validated<T> {
  ok: boolean;
  value: T | null;
  warnings: string[];
}

const isoDate = z.string().refine((s) => {
  const y = new Date(s).getUTCFullYear();
  return Number.isFinite(y) && y >= 1990 && y <= 2100;
}, "date outside plausible range");

const recordSchema = z.object({
  wins: z.number().int().min(0).max(500),
  losses: z.number().int().min(0).max(500),
  draws: z.number().int().min(0).max(200),
  noContests: z.number().int().min(0).max(200),
});

const fighterSchema = z.object({
  slug: z.string().min(1),
  url: z.string().url(),
  name: z.string().min(1),
  record: recordSchema.nullable(),
});

const eventSchema = z.object({
  slug: z.string().min(1),
  url: z.string().url(),
  name: z.string().min(1),
  date: isoDate.nullable(),
});

/** Validate an event. Rejects only when identity is unusable. */
export function validateEvent(e: BkfcEvent): Validated<BkfcEvent> {
  const warnings: string[] = [];
  const parsed = eventSchema.safeParse(e);
  if (!parsed.success) {
    return { ok: false, value: null, warnings: [`event ${e.slug}: ${issue(parsed.error)}`] };
  }
  if (!e.date) warnings.push(`event ${e.slug}: no parseable date`);
  if (!e.venue) warnings.push(`event ${e.slug}: missing venue`);
  if (e.bouts.length === 0) warnings.push(`event ${e.slug}: empty card`);

  // Duplicate bouts (same ordered pair) would double-write fights.
  const pairs = new Set<string>();
  for (const b of e.bouts) {
    const key = `${b.redSlug ?? b.redName}|${b.blueSlug ?? b.blueName}`;
    if (pairs.has(key)) warnings.push(`event ${e.slug}: duplicate bout ${key}`);
    pairs.add(key);
    if (b.redName === b.blueName) warnings.push(`event ${e.slug}: bout with identical corners (${b.redName})`);
  }
  return { ok: true, value: e, warnings };
}

/** Validate a fighter. Rejects impossible records / missing identity. */
export function validateFighter(f: BkfcFighter): Validated<BkfcFighter> {
  const parsed = fighterSchema.safeParse(f);
  if (!parsed.success) {
    return { ok: false, value: null, warnings: [`fighter ${f.slug}: ${issue(parsed.error)}`] };
  }
  const warnings: string[] = [];
  if (!f.record) warnings.push(`fighter ${f.slug}: no record`);
  if (f.heightCm != null && (f.heightCm < 120 || f.heightCm > 230))
    warnings.push(`fighter ${f.slug}: implausible height ${f.heightCm}cm`);
  if (f.reachCm != null && (f.reachCm < 120 || f.reachCm > 250))
    warnings.push(`fighter ${f.slug}: implausible reach ${f.reachCm}cm`);
  return { ok: true, value: f, warnings };
}

/** Validate a ranking row. */
export function validateRanking(r: BkfcRankingRow): Validated<BkfcRankingRow> {
  if (!r.division || !r.fighterName || r.rank < 0 || r.rank > 100) {
    return { ok: false, value: null, warnings: [`ranking: malformed row ${JSON.stringify(r)}`] };
  }
  return { ok: true, value: r, warnings: [] };
}

/** Validate an article. */
export function validateArticle(a: BkfcArticle): Validated<BkfcArticle> {
  if (!a.slug || !a.title) {
    return { ok: false, value: null, warnings: [`article ${a.slug}: missing title/slug`] };
  }
  const warnings: string[] = [];
  if (!a.publishedAt) warnings.push(`article ${a.slug}: no publish date`);
  if (!a.content) warnings.push(`article ${a.slug}: empty body`);
  return { ok: true, value: a, warnings };
}

function issue(err: z.ZodError): string {
  return err.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
}
