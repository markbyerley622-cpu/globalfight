// ════════════════════════════════════════════════════════════════════════════
//  WHAT A PROMOTER OWNS — and why it has to be written down.
//
//  ── The failure this prevents ─────────────────────────────────────────────
//  A promoter's event is not a scraped event. They are the SOURCE for their own
//  card: they know the venue, the running order and who pulled out, and they
//  know it before any provider does.
//
//  But a promoter event lands in the same Event/Fight rows the ingest pipeline
//  writes, and those scrapers re-run on cron and rewrite the whole row. The
//  schema says so in two places, in the comments on `Event.lockedFields` and
//  `Fight.lockedFields`: without a lock, "every manual correction would
//  silently revert within hours", and on Fight specifically, "the ingest
//  pipeline rewrites orderOnCard from the SOURCE's index on every run, so
//  drag-and-drop ordering would be destroyed by the next cron".
//
//  So a promoter who spends ten minutes building a card, publishes it, and
//  comes back the next morning would find their bout order shuffled and their
//  venue replaced — with no error, no trace, and no reason for them to suspect
//  it. That is the single most damaging thing that could happen to this
//  feature, and it happens by DEFAULT unless publishing claims its fields.
//
//  ── Why a list and not "lock everything" ──────────────────────────────────
//  Locking the whole row would freeze the automatic RESULT updates too, which
//  is the one thing the pipeline is genuinely better at — it watches sources
//  around the clock and the promoter is in an arena. Per-field is the same call
//  lib/admin/provenance already makes for operators, for the same reason.
//
//  PURE. No prisma, no env — so the rule is unit-testable, which matters more
//  here than almost anywhere else: the failure mode is silent.
// ════════════════════════════════════════════════════════════════════════════

import {
  LOCKABLE_EVENT_FIELDS,
  LOCKABLE_FIGHT_FIELDS,
  withLocked,
} from "@/lib/admin/provenance";

/**
 * Event fields a promoter is authoritative for.
 *
 * `status` is deliberately ABSENT. The promoter sets an event live, but the
 * lifecycle after that — SCHEDULED → LIVE → COMPLETED — is driven by the clock
 * and the results pipeline, and freezing it would strand a card at SCHEDULED
 * through its own fight night.
 *
 * `slug` is absent for a different reason: it is derived, and a lock on a
 * derived field pins the derivation rather than a decision.
 */
export const PROMOTER_OWNED_EVENT_FIELDS = [
  "name",
  "promotion",
  "sport",
  "date",
  "venue",
  "city",
  "country",
  "countryCode",
  "posterUrl",
  "broadcaster",
  "ticketUrl",
  "eventUrl",
  "timezone",
  "description",
  "broadcastStartAt",
  "prelimStartAt",
  "mainCardStartAt",
] as const;

/**
 * Fight fields a promoter is authoritative for.
 *
 * `orderOnCard` is the one that matters most — see the schema comment quoted
 * above. It is also the least obvious, because nothing about a shuffled card
 * looks like data loss; it looks like the promoter misremembering.
 *
 * The RESULT fields (`result`, `winnerId`, `method`, `roundEnded`, `timeEnded`)
 * are NOT here. They are claimed at the moment the promoter actually records
 * one — see `promoterResultLocks` — because locking them at publish time would
 * freeze them empty and block the pipeline from filling in a result the
 * promoter never got round to entering.
 */
export const PROMOTER_OWNED_FIGHT_FIELDS = [
  "redId",
  "blueId",
  "weightClassId",
  "scheduledRounds",
  "titleFight",
  "interimTitle",
  "mainEvent",
  "coMain",
  "orderOnCard",
  "cardSegment",
  "cancelled",
  "cardNote",
  "estimatedStartAt",
] as const;

/** Result fields, claimed only once the promoter records one. */
export const PROMOTER_RESULT_FIELDS = [
  "result",
  "winnerId",
  "method",
  "roundEnded",
  "timeEnded",
] as const;

/**
 * The lock list for a promoter's event, merged over whatever is already locked.
 *
 * `fields` narrows it to the subset actually written — publishing claims
 * everything, an inline edit of one field claims one — so an untouched field
 * stays open to the pipeline.
 */
export function promoterEventLocks(
  existing: readonly string[],
  fields: readonly string[] = PROMOTER_OWNED_EVENT_FIELDS,
): string[] {
  return withLocked(existing, fields);
}

export function promoterFightLocks(
  existing: readonly string[],
  fields: readonly string[] = PROMOTER_OWNED_FIGHT_FIELDS,
): string[] {
  return withLocked(existing, fields);
}

/** Claim the result fields. Called when a result is recorded, not at publish. */
export function promoterResultLocks(existing: readonly string[]): string[] {
  return withLocked(existing, PROMOTER_RESULT_FIELDS);
}

/**
 * Every promoter-owned field must also be LOCKABLE.
 *
 * `stripLocked` filters an ingest payload by name, so a field listed here but
 * missing from `LOCKABLE_EVENT_FIELDS` / `LOCKABLE_FIGHT_FIELDS` produces a
 * lock that does precisely nothing — and the scraper overwrites it on the next
 * cron, silently. Exported so a test asserts it rather than a comment asking
 * someone to remember.
 */
export function unlockableFields(): { event: string[]; fight: string[] } {
  const eventSet = new Set<string>(LOCKABLE_EVENT_FIELDS);
  const fightSet = new Set<string>(LOCKABLE_FIGHT_FIELDS);
  return {
    event: PROMOTER_OWNED_EVENT_FIELDS.filter((f) => !eventSet.has(f)),
    fight: [...PROMOTER_OWNED_FIGHT_FIELDS, ...PROMOTER_RESULT_FIELDS]
      .filter((f) => !fightSet.has(f)),
  };
}
