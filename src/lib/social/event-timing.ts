// ════════════════════════════════════════════════════════════════════════════
//  When is an event too old to announce? PURE.
//
//  Extracted from event-triggers so it can be unit-tested. That module is
//  `server-only` (it reaches prisma and the notification store), which the unit
//  runner cannot import — and a date comparison has no business being server-only
//  in the first place.
// ════════════════════════════════════════════════════════════════════════════

/**
 * Grace window after first bell during which an event still counts as current.
 *
 * Not zero: a card runs for hours, and a genuine mid-event change — a late
 * replacement, a bout order reshuffle — is exactly when a follower most wants to
 * hear about it. 12h covers the longest card plus timezone slack in the stored date.
 */
export const HISTORICAL_GRACE_MS = 12 * 60 * 60 * 1000;

/**
 * Is this event far enough in the past that an announcement would be absurd?
 *
 * Every announcement notification is written in the future tense — "X announced",
 * "card updated" — and exists to bring someone back for a fight that has not
 * happened. A backfill writing results to a 2025 event is bookkeeping, not news. The
 * results sweep fired roughly ten of these bursts per run across cards up to a year
 * old, each telling followers about a fight that finished months ago.
 */
export function isHistorical(date: Date, now: Date = new Date()): boolean {
  return date.getTime() + HISTORICAL_GRACE_MS < now.getTime();
}
