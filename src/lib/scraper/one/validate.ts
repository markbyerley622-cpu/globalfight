// ════════════════════════════════════════════════════════════════════════
//  ONE Championship — validation gate for events.
// ════════════════════════════════════════════════════════════════════════

import type { OneEvent } from "./types";

export interface Validated<T> {
  ok: boolean;
  value: T | null;
  warnings: string[];
}

export function validateOneEvent(e: OneEvent): Validated<OneEvent> {
  if (!e.slug || !e.name) {
    return { ok: false, value: null, warnings: [`one event ${e.slug}: missing name/slug`] };
  }
  if (e.date) {
    const year = new Date(e.date).getUTCFullYear();
    if (!Number.isFinite(year) || year < 1990 || year > 2100) {
      return { ok: false, value: null, warnings: [`one event ${e.slug}: date out of range (${e.date})`] };
    }
  }
  const warnings: string[] = [];
  if (!e.date) warnings.push(`one event ${e.slug}: no parseable date`);
  if (!e.venue) warnings.push(`one event ${e.slug}: missing venue`);
  return { ok: true, value: e, warnings };
}
