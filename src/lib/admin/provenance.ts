// ════════════════════════════════════════════════════════════════════════════
//  Field-level provenance — the rule that makes the editor real.
//
//  Deliberately NOT server-only: these are pure functions over plain objects
//  with no database or request dependency, and marking them server-only would
//  make the single most safety-critical rule in the admin untestable.
//
//  Every scraper re-runs on cron and writes the whole row: name, date, venue,
//  status, results, and — worst of all — orderOnCard, rebuilt from the source's
//  own index. An operator who fixes a venue, enters a result early, or drags a
//  card into the right order would see it revert within hours, with no error and
//  no trace. A CMS on top of that is decoration.
//
//  So: whenever a human writes a field, its name goes into `lockedFields`, and
//  ingest is filtered through `stripLocked` before it touches the row.
//
//  Locking is per FIELD, deliberately. Freezing the whole row would mean fixing
//  one typo in a venue also froze the automatic result updates for that card —
//  operators would stop correcting things, which is the opposite of the point.
// ════════════════════════════════════════════════════════════════════════════

/**
 * Remove keys an operator owns from an ingest payload.
 *
 * Returns a NEW object; the caller's payload is untouched. Keys absent from
 * `locked` pass through unchanged, so automation keeps updating everything a
 * human has not claimed.
 */
export function stripLocked<T extends Record<string, unknown>>(data: T, locked: readonly string[]): Partial<T> {
  if (!locked.length) return data;
  const lockedSet = new Set(locked);
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(data)) {
    if (!lockedSet.has(k)) out[k] = v;
  }
  return out as Partial<T>;
}

/** Union of the fields already locked and the ones this edit touches. */
export function withLocked(existing: readonly string[], edited: readonly string[]): string[] {
  return [...new Set([...existing, ...edited])].sort();
}

/**
 * Fields an operator may claim on an Event. Anything outside this list is
 * either derived, owned by the system, or not safe to freeze.
 */
export const LOCKABLE_EVENT_FIELDS = [
  "name", "slug", "promotion", "sport", "status", "venue", "city", "country", "countryCode",
  "broadcaster", "posterUrl", "heroUrl", "description", "timezone", "eventUrl", "ticketUrl",
  "date", "broadcastStartAt", "prelimStartAt", "mainCardStartAt",
] as const;

/** Fields an operator may claim on a Fight. */
export const LOCKABLE_FIGHT_FIELDS = [
  "redId", "blueId", "weightClassId", "scheduledRounds", "titleFight", "interimTitle",
  "mainEvent", "coMain", "orderOnCard", "cardSegment", "cancelled", "cardNote",
  "estimatedStartAt", "result", "winnerId", "method", "roundEnded", "timeEnded",
  "performanceBonus", "fightOfTheNight",
] as const;

const EVENT_SET: ReadonlySet<string> = new Set(LOCKABLE_EVENT_FIELDS);
const FIGHT_SET: ReadonlySet<string> = new Set(LOCKABLE_FIGHT_FIELDS);

export const lockableEventFields = (keys: string[]): string[] => keys.filter((k) => EVENT_SET.has(k));
export const lockableFightFields = (keys: string[]): string[] => keys.filter((k) => FIGHT_SET.has(k));
