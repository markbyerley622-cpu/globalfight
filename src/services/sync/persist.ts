// Persist aggregated provider records into the canonical Fighter/Event/Fight
// tables. Identity is resolved through the dedupe engine so the same fighter or
// card arriving from several sources lands on one row; provenance is recorded in
// the *ExternalId link tables when present.
//
// Provenance writes (ExternalId / Alias) are wrapped in best-effort try/catch so
// a database that hasn't run `db:push` for the additive models still gets the
// core enrichment (the visible fix) without throwing.

import type { FightMethod } from "@prisma/client";
import { prisma } from "@/lib/db";
import { stripLocked } from "@/lib/admin/provenance";
import { preventResultDowngrade, requireAttributedWinner } from "@/lib/intelligence/result-integrity";
import { recordConflicts } from "@/lib/admin/reconcile";
import { onResultWritten } from "@/lib/intelligence/resolve";
import { recordIngestEvidence } from "@/lib/results/pipeline";
import { notifyEventChanges, snapshotEvent } from "@/lib/social/event-triggers";
import { notifyFightAnnounced, notifyFightChanges } from "@/lib/social/fighter-triggers";
import { slugify } from "@/lib/utils";
import { normalizeText } from "@/lib/text/entities";
import { toCountryCode } from "@/lib/countries";
import { invalidate } from "@/lib/cache";
import { log } from "@/lib/scraper/logger";
import { supportsLiveResultUpdates } from "@/lib/scraper/source-policy";
import type { Sport } from "@/lib/types";
import type { NormalizedEvent, NormalizedFighter, NormalizedFightStub } from "../providers/types";
import { resolveFighter } from "../dedupe/fighters";
import { resolveEvent } from "../dedupe/events";
import { looseKey } from "../normalization/names";
import type { SyncEntity } from "./run";

/** Drop keys whose value is undefined so Prisma updates never null out good data. */
function defined<T extends Record<string, unknown>>(obj: T): Partial<T> {
  const out: Partial<T> = {};
  for (const [k, v] of Object.entries(obj)) if (v !== undefined) (out as Record<string, unknown>)[k] = v;
  return out;
}

export async function persistAggregated(
  sport: Sport,
  entity: SyncEntity,
  records: Array<NormalizedFighter | NormalizedEvent>,
): Promise<number> {
  if (entity === "fighters") return persistFighters(sport, records as NormalizedFighter[]);
  return persistEvents(sport, records as NormalizedEvent[]);
}

// â”€â”€â”€ fighters â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

async function persistFighters(sport: Sport, fighters: NormalizedFighter[]): Promise<number> {
  let written = 0;
  for (const f of fighters) {
    try {
      await upsertFighter(sport, f);
      written++;
    } catch (e) {
      log.warn({ name: f.name, err: (e as Error).message }, "persist:fighter-failed");
    }
  }
  if (written) await invalidate("fighters:all");
  log.info({ sport, written }, "persist:fighters:done");
  return written;
}

/** Resolve (or create) the canonical fighter and fill any fields the source provides. Returns its id. */
async function upsertFighter(sport: Sport, f: NormalizedFighter): Promise<string> {
  const match = await resolveFighter({ source: f._meta.source, externalId: f.externalId, name: f.name, sport });

  const fill = defined({
    name: f.name,
    nickname: f.nickname,
    nationality: f.nationality,
    countryCode: f.countryCode,
    heightCm: f.heightCm,
    reachCm: f.reachCm,
    stance: f.stance,
    wins: f.wins,
    losses: f.losses,
    draws: f.draws,
    // Source headshot URL, displayed via the /api/img proxy (not re-hosted).
    // Enabled per explicit operator authorization; overrides the default
    // "promotion-photos" posture for dev. Only set when a provider supplies one.
    imageUrl: f.imageUrl,
    lastScrapedAt: new Date(),
  });

  let fighterId: string;
  if (match.fighterId) {
    await prisma.fighter.update({ where: { id: match.fighterId }, data: fill });
    fighterId = match.fighterId;
  } else {
    const slug = slugify(f.name);
    const row = await prisma.fighter.upsert({
      where: { slug },
      update: fill, // sport intentionally not updated â€” first source owns it
      create: {
        slug, sport, name: f.name,
        nickname: f.nickname ?? null,
        nationality: f.nationality ?? null,
        countryCode: f.countryCode ?? null,
        heightCm: f.heightCm ?? null,
        reachCm: f.reachCm ?? null,
        stance: f.stance ?? null,
        imageUrl: f.imageUrl ?? null,
        wins: f.wins ?? 0, losses: f.losses ?? 0, draws: f.draws ?? 0,
      },
    });
    fighterId = row.id;
  }

  await linkFighterExternalId(fighterId, f);
  await recordAliases(fighterId, f);
  return fighterId;
}

async function linkFighterExternalId(fighterId: string, f: NormalizedFighter): Promise<void> {
  if (!f.externalId) return;
  try {
    await prisma.fighterExternalId.upsert({
      where: { source_externalId: { source: f._meta.source, externalId: f.externalId } },
      update: { fighterId, confidence: f._meta.confidence },
      create: { fighterId, source: f._meta.source, externalId: f.externalId, confidence: f._meta.confidence },
    });
  } catch {
    /* additive table not migrated yet â€” core enrichment already applied */
  }
}

async function recordAliases(fighterId: string, f: NormalizedFighter): Promise<void> {
  const aliases = [...(f.aliases ?? []), ...(f.nickname ? [f.nickname] : [])].filter(Boolean);
  for (const alias of aliases) {
    const normalized = looseKey(alias);
    if (!normalized) continue;
    try {
      const exists = await prisma.fighterAlias.findFirst({ where: { fighterId, normalized }, select: { id: true } });
      if (!exists) {
        await prisma.fighterAlias.create({ data: { fighterId, alias, normalized, source: f._meta.source } });
      }
    } catch {
      /* additive table not migrated yet */
    }
  }
}

// â”€â”€â”€ events â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

async function persistEvents(sport: Sport, events: NormalizedEvent[]): Promise<number> {
  let written = 0;
  for (const ev of events) {
    try {
      await upsertEvent(sport, ev);
      written++;
    } catch (e) {
      log.warn({ name: ev.name, err: (e as Error).message }, "persist:event-failed");
    }
  }
  if (written) {
    await invalidate("events:upcoming");
    await invalidate("events:results");
  }
  log.info({ sport, written }, "persist:events:done");
  return written;
}

async function upsertEvent(sport: Sport, ev: NormalizedEvent): Promise<void> {
  const date = new Date(ev.date);
  if (Number.isNaN(+date)) throw new Error(`invalid date: ${ev.date}`);

  // THE CHOKEPOINT. Every provider's events arrive here, so the name is
  // normalized once, at the boundary, rather than trusted to each extractor.
  //
  // ONE's extractor hand-rolled a partial entity decode and eight cards were
  // stored as "Kings &#038; Champions", slugged `kings-038-champions`, and then
  // failed to match the correctly-named copy Wikipedia had already written â€”
  // two rows per card, one empty, one holding the bouts. A provider-local
  // decode is always a partial decode, and the next provider would have found
  // its own way to do the same thing. Normalizing here means it cannot recur
  // whatever a future extractor forgets.
  //
  // This is the DISPLAY value (entities resolved, whitespace collapsed).
  // Matching uses canonicalizeTitle separately â€” see lib/text/entities.
  const name = normalizeText(ev.name) || ev.name;

  const match = await resolveEvent({ source: ev._meta.source, externalId: ev.externalId, name, sport, date: ev.date });

  // The card's shape BEFORE this write, so the notification layer can tell an
  // announcement from a re-ingest. Taken here rather than inside the branches
  // below because an unmatched event may still resolve to an existing row via its
  // slug in the upsert â€” in which case it is an update, not an announcement, and a
  // snapshot taken only on the `match.eventId` path would have called it new.
  const before = match.eventId
    ? await snapshotEvent({ id: match.eventId })
    : await snapshotEvent({ slug: slugify(name) || slugify(`${name}-${ev.date.slice(0, 10)}`) });

  const fill = defined({
    name,
    promotion: ev.promotion,
    venue: ev.venue,
    city: ev.city,
    country: ev.country,
    countryCode: ev.countryCode ?? toCountryCode(ev.country),
    broadcaster: ev.broadcaster,
    posterUrl: (ev as { posterUrl?: string }).posterUrl,
    date,
    status: ev.status,
  });

  let eventId: string;
  if (match.eventId) {
    // Never overwrite a field an operator owns. Without this the admin editor
    // is decorative: this runs on cron and would revert every manual correction
    // to name/date/venue/status within hours, silently.
    const current = await prisma.event.findUnique({ where: { id: match.eventId } });
    const locked = current?.lockedFields ?? [];
    const data = stripLocked(fill, locked);
    if (Object.keys(data).length > 0) {
      await prisma.event.update({ where: { id: match.eventId }, data });
    }
    // Whatever the lock refused is recorded for review, so the operator learns
    // the source disagrees instead of the two systems diverging in silence.
    await recordConflicts("Event", match.eventId, fill, locked, (current ?? {}) as Record<string, unknown>, ev._meta.source);
    eventId = match.eventId;
  } else {
    const slug = slugify(name) || slugify(`${name}-${ev.date.slice(0, 10)}`);
    const row = await prisma.event.upsert({
      where: { slug },
      update: fill,
      create: {
        slug, sport, name,
        promotion: ev.promotion ?? null,
        venue: ev.venue ?? null,
        city: ev.city ?? null,
        country: ev.country ?? null,
        countryCode: ev.countryCode ?? toCountryCode(ev.country) ?? null,
        broadcaster: ev.broadcaster ?? null,
        date,
        status: ev.status ?? "SCHEDULED",
      },
    });
    eventId = row.id;
  }

  await linkEventExternalId(eventId, ev);

  // Attach the card.
  const fights = ev.fights ?? [];
  for (let i = 0; i < fights.length; i++) {
    try {
      await upsertFight(sport, eventId, ev, fights[i], i);
    } catch (e) {
      log.warn({ event: ev.name, err: (e as Error).message }, "persist:fight-failed");
    }
  }

  // Completion state, recomputed now that the card is whatever this write made it.
  await refreshCardCompletion(eventId);

  // FOLLOWERS, after the whole card has landed. One diff for the event and its
  // card, so a twelve-bout import is "the card is live", not twelve notifications.
  // The per-BOUT facts (a fighter booked, a bout scratched) are fired by
  // upsertFight, which is the only place that knows whether a given bout is new.
  await notifyEventChanges(before, eventId);

  await invalidate(`event:${slugify(name)}`);
}

/**
 * Set or clear `Event.resultsCompleteAt` from what the card now actually says.
 *
 * A card is complete when it is in the PAST, has at least one bout, and none of
 * them is still SCHEDULED. The results cron skips completed cards, which is what
 * stops the hourly job from re-querying all of history.
 *
 * It CLEARS as readily as it sets, and that matters more than it looks: a card
 * that gains a late bout, or whose result an operator un-decides, must re-enter
 * the queue. A completion flag that could only ever be set would eventually be a
 * claim with no evidence behind it â€” the derived value is always recomputed here,
 * never trusted from last time.
 *
 * Best-effort: this is bookkeeping, and it must never be the reason a
 * successfully-harvested card fails to persist.
 */
async function refreshCardCompletion(eventId: string): Promise<void> {
  try {
    const event = await prisma.event.findUnique({
      where: { id: eventId },
      select: { date: true, resultsCompleteAt: true, resultsTerminalReason: true },
    });
    if (!event) return;

    const [total, pending] = await Promise.all([
      prisma.fight.count({ where: { eventId } }),
      prisma.fight.count({ where: { eventId, result: "SCHEDULED" } }),
    ]);

    const past = event.date < new Date();
    const complete = past && total > 0 && pending === 0;

    // TERMINAL: past, still has undecided bouts, and every source that covers it
    // is a one-shot import. No later visit can add anything, so this is not
    // "incomplete" â€” it is finished, with gaps the source itself has.
    let terminal: string | null = null;
    if (past && !complete && total > 0) {
      const sources = await prisma.eventExternalId.findMany({ where: { eventId }, select: { source: true } });
      const known = sources.map((s) => s.source);
      if (known.length > 0 && known.every((s) => !supportsLiveResultUpdates(s))) {
        terminal = `static source (${[...new Set(known)].join(", ")}) published no outcome for ${pending} of ${total} bouts`;
      }
    }

    if (complete === (event.resultsCompleteAt !== null) && terminal === event.resultsTerminalReason) return;
    await prisma.event.update({
      where: { id: eventId },
      data: {
        resultsCompleteAt: complete ? new Date() : null,
        // Cleared whenever the card completes, so the reason never outlives it.
        resultsTerminalReason: complete ? null : terminal,
      },
    });
  } catch (e) {
    log.warn({ eventId, err: (e as Error).message }, "persist:completion-flag-failed");
  }
}

async function linkEventExternalId(eventId: string, ev: NormalizedEvent): Promise<void> {
  if (!ev.externalId) return;
  try {
    await prisma.eventExternalId.upsert({
      where: { source_externalId: { source: ev._meta.source, externalId: ev.externalId } },
      update: { eventId, confidence: ev._meta.confidence },
      create: { eventId, source: ev._meta.source, externalId: ev.externalId, confidence: ev._meta.confidence },
    });
  } catch {
    /* additive table not migrated yet */
  }
}

/**
 * Resolve a fight-stub corner to an existing fighter, or PLAN a creation. This
 * is the read-heavy dedupe step (a `contains` scan), so it runs OUTSIDE the
 * fight transaction to keep that transaction short.
 */
type CornerPlan = { id: string; create: false } | { slug: string; name: string; create: true };
async function planCorner(
  sport: Sport,
  source: string,
  name: string,
  externalId: string | undefined,
): Promise<CornerPlan | null> {
  if (!name?.trim()) return null;
  const match = await resolveFighter({ source, externalId, name, sport });
  if (match.fighterId) return { id: match.fighterId, create: false };
  const slug = slugify(name);
  if (!slug) return null;
  return { slug, name, create: true };
}

/**
 * Record WHERE this bout came from. Best-effort: the table is additive and a
 * database that hasn't run `db:push` must still get the bout itself.
 *
 * `created` is the field that matters for cleanup â€” a row this import CREATED can be
 * removed if the import turns out to be wrong; a row it merely updated predates it
 * and must not be.
 */
async function recordFightImport(
  fightId: string,
  source: string,
  sourceRef: string | undefined,
  created: boolean,
): Promise<void> {
  try {
    await prisma.fightImport.upsert({
      where: { fightId_source: { fightId, source } },
      // A later touch of the same bout by the same source never re-claims authorship.
      update: { sourceRef: sourceRef ?? null, importedAt: new Date() },
      create: { fightId, source, sourceRef: sourceRef ?? null, created },
    });
  } catch {
    /* additive table not migrated yet â€” the bout itself already landed */
  }
}

/** Best-effort provenance link. Kept OUTSIDE the fight transaction: this touches
 *  an additive table that may not be migrated, and inside a transaction that
 *  error would abort (poison) the whole write. */
async function linkCornerExternalId(source: string, externalId: string | undefined, fighterId: string): Promise<void> {
  if (!externalId) return;
  try {
    await prisma.fighterExternalId.upsert({
      where: { source_externalId: { source, externalId } },
      update: { fighterId },
      create: { fighterId, source, externalId, confidence: 0.8 },
    });
  } catch { /* additive table not migrated yet */ }
}

async function upsertFight(
  sport: Sport,
  eventId: string,
  ev: NormalizedEvent,
  stub: NormalizedFightStub,
  index: number,
): Promise<void> {
  const source = ev._meta.source;
  // Reads (dedupe scans) happen here, before the transaction opens.
  const redPlan = await planCorner(sport, source, stub.redName, stub.redExternalId);
  const bluePlan = await planCorner(sport, source, stub.blueName, stub.blueExternalId);
  if (!redPlan || !bluePlan) return;

  let weightClassId: string | undefined;
  if (stub.weightClass) {
    const wc = await prisma.weightClass.findFirst({
      where: { sport, name: { equals: stub.weightClass, mode: "insensitive" } },
      select: { id: true },
    });
    weightClassId = wc?.id;
  }

  // Normalized here too: a bout slug built from an encoded card name inherits
  // the same corruption, so `kings-038-champions-a-vs-b` would have been the
  // fight-level version of the duplicate-event bug.
  const slug = slugify(`${normalizeText(ev.name)}-${stub.redName}-vs-${stub.blueName}`);
  const date = new Date(ev.date);

  // Atomic core: any corner fighters that must be created land together with the
  // fight, or not at all â€” a mid-write failure never leaves orphan corner
  // fighters created for a bout that didn't persist. Only fast writes are inside;
  // the slow dedupe reads (above) and additive provenance (below) stay outside.
  const outcome = await prisma.$transaction(async (tx) => {
    const redId = redPlan.create
      ? (await tx.fighter.upsert({ where: { slug: redPlan.slug }, update: {}, create: { slug: redPlan.slug, sport, name: redPlan.name } })).id
      : redPlan.id;
    const blueId = bluePlan.create
      ? (await tx.fighter.upsert({ where: { slug: bluePlan.slug }, update: {}, create: { slug: bluePlan.slug, sport, name: bluePlan.name } })).id
      : bluePlan.id;

    let winnerId: string | undefined;
    if (stub.winnerExternalId) {
      if (stub.winnerExternalId === stub.redExternalId) winnerId = redId;
      else if (stub.winnerExternalId === stub.blueExternalId) winnerId = blueId;
    }

    // The match above fails whenever a source is internally inconsistent, and it
    // fails SILENTLY: `winnerId` stays undefined while `stub.result` is still
    // "WIN". Writing that pair records a bout won by nobody â€” unusable for
    // records and settlement, and an invalid state every reader then has to
    // guess about. An unattributed win is downgraded to SCHEDULED so the
    // harvester retries it against a source that can name the winner.
    const { update: outcome, rejected: unattributed } = requireAttributedWinner(
      { result: stub.result, method: stub.method, roundEnded: stub.roundEnded, winnerId },
      { redId, blueId },
    );
    if (unattributed) {
      console.warn(
        `[persist] ${source}: dropped an unattributable WIN on ${stub.redName} vs ${stub.blueName} ` +
          `(winnerExternalId=${stub.winnerExternalId ?? "none"} matched neither corner)`,
      );
    }

    const data = defined({
      eventId,
      redId, blueId,
      weightClassId,
      scheduledRounds: stub.scheduledRounds,
      titleFight: stub.titleFight,
      mainEvent: stub.mainEvent,
      orderOnCard: stub.mainEvent ? 0 : index + 1,
      result: outcome.result,
      method: outcome.method,
      roundEnded: outcome.roundEnded,
      winnerId: outcome.winnerId,
      date,
    });

    // â”€â”€ IDENTITY: the corner PAIR on this event, then the slug â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    //
    // A bout is "the same bout" when it is the same two fighters on the same card.
    // Keying on a name-derived slug alone was wrong the moment two pipelines built
    // that name differently â€” and they do: the odds pipeline creates production's
    // boxing/MMA bouts as `{red}-vs-{blue}` under a synthetic daily card, while this
    // function builds `{eventName}-{red}-vs-{blue}`. Same bout, two slugs.
    //
    // The consequence was silent and severe: a Wikipedia result would be written to a
    // NEW row while every pick, battle and prediction stayed on the original. The
    // ingest job would report written=1, the reader's prediction would never settle,
    // and the card would show two copies of the same fight.
    //
    // Corner order is not part of identity either â€” sources disagree about which
    // fighter is "red", so both orientations resolve to the one bout.
    const existing =
      (await tx.fight.findFirst({
        where: {
          eventId,
          OR: [
            { redId, blueId },
            { redId: blueId, blueId: redId },
          ],
        },
      })) ??
      // Fallback: same bout name on a card we haven't matched by corners (a fighter
      // row that was since deduped and re-pointed).
      (await tx.fight.findUnique({ where: { slug } }));
    if (existing) {
      // THREE guards now, in order:
      //  (1) never re-seat the CORNERS of a bout that already exists. FightPick
      //      stores "RED"/"BLUE", not a fighter id, so swapping redId/blueId would
      //      silently invert the meaning of every pick, battle and graded result on
      //      the bout. A source reporting the corners the other way round is the
      //      same bout (that is why identity ignores order) â€” it is not a licence to
      //      rewrite which corner is which. `winnerId` is a Fighter id and therefore
      //      orientation-independent, so the result still lands correctly.
      //  (2) never let a later sync un-decide a bout back to SCHEDULED.
      //  (3) never overwrite operator-locked fields.
      const { redId: _r, blueId: _b, ...corneless } = data;
      const guarded = preventResultDowngrade(existing.result, corneless);
      const update = stripLocked(guarded, existing.lockedFields);
      if (Object.keys(update).length > 0) {
        await tx.fight.update({ where: { id: existing.id }, data: update });
      }
      // Did THIS write decide a bout that wasn't decided before? That transition is
      // the domain event every downstream consumer hangs off.
      const decided =
        existing.result === "SCHEDULED" &&
        typeof update.result === "string" &&
        update.result !== "SCHEDULED";
      return { fightId: existing.id, existing, data, redId, blueId, decided };
    }

    const created = await tx.fight.upsert({
      where: { slug },
      update: data,
      create: {
        slug,
        eventId,
        redId, blueId,
        weightClassId: weightClassId ?? null,
        scheduledRounds: stub.scheduledRounds ?? 12,
        titleFight: stub.titleFight ?? false,
        mainEvent: stub.mainEvent ?? false,
        orderOnCard: stub.mainEvent ? 0 : index + 1,
        result: outcome.result ?? "SCHEDULED",
        method: outcome.method ?? null,
        roundEnded: outcome.roundEnded ?? null,
        winnerId: outcome.winnerId ?? null,
        date,
      },
    });
    // A brand-new row can also arrive already decided (a Wikipedia results table
    // backfilling a card we never held), and picks may already exist against it.
    return {
      fightId: created.id,
      existing: null,
      data,
      redId,
      blueId,
      decided: (outcome.result ?? "SCHEDULED") !== "SCHEDULED",
    };
  });

  // Best-effort provenance, OUTSIDE the transaction. Link only corners we just
  // created, matching the prior behaviour (matched fighters keep their existing
  // provenance from the fighters-entity sync path).
  if (redPlan.create) await linkCornerExternalId(source, stub.redExternalId, outcome.redId);
  if (bluePlan.create) await linkCornerExternalId(source, stub.blueExternalId, outcome.blueId);
  if (outcome.existing) {
    await recordConflicts("Fight", outcome.fightId, outcome.data, outcome.existing.lockedFields, outcome.existing as unknown as Record<string, unknown>, source);
  }

  // PROVENANCE. Best-effort and outside the transaction, like every other additive
  // table here. Without it a repair cannot be audited afterwards: "which bouts did
  // this job write, and from which page?" had no answer, so cleaning up a bad import
  // meant inferring intent from slug shapes.
  await recordFightImport(outcome.fightId, source, ev.externalId, outcome.existing === null);

  // FOLLOWER-FACING BOUT FACTS. The transaction above is the only place that knows
  // whether this bout already existed, so the diff is built from what it returned
  // rather than re-read (a re-read would see the post-write state and could never
  // tell a booking from a re-ingest).
  //
  // Guarded inside the triggers: a bout that arrives already decided is history
  // being backfilled, not a booking, and announcing it would be the single fastest
  // way to destroy trust in the category.
  if (outcome.existing === null) {
    await notifyFightAnnounced(outcome.fightId);
  } else {
    await notifyFightChanges(
      {
        id: outcome.existing.id,
        cancelled: outcome.existing.cancelled,
        date: outcome.existing.date,
        eventId: outcome.existing.eventId,
        result: outcome.existing.result,
      },
      outcome.fightId,
    );
  }

  // SETTLEMENT, fired by the write that caused it. Ingest used to stop at
  // Fight.result and leave every prediction on the bout open until a cron happened
  // to run â€” the gap that let a decided fight coexist with an open prediction.
  // onResultWritten never throws: the result is the fact, settlement is a
  // consequence, and resolveDuePicks re-tries anything that fails here.
  if (outcome.decided) {
    // AUDIT TRAIL, before settlement. Wikipedia and the official providers write
    // results directly and always have; this records what they said as evidence and
    // stamps the bout as published-by-them, so every verified result in the product â€”
    // whether it came from an ingest or from the intelligence pipeline â€” has the same
    // history behind it in /admin/results. Bookkeeping only: it never gates the write
    // and never throws.
    const decidedWinner =
      outcome.data.winnerId === outcome.redId ? "RED"
        : outcome.data.winnerId === outcome.blueId ? "BLUE"
          : null;
    const decidedResult = String(outcome.data.result ?? "WIN");
    await recordIngestEvidence(outcome.fightId, source, {
      outcome: decidedResult === "DRAW" ? "DRAW" : decidedResult === "NO_CONTEST" ? "NO_CONTEST" : "WIN",
      winnerCorner: decidedWinner,
      method: (outcome.data.method as FightMethod | undefined) ?? null,
      roundEnded: (outcome.data.roundEnded as number | undefined) ?? null,
      sourceRef: ev.externalId ?? null,
    });

    await onResultWritten(outcome.fightId, source);
  }
}
