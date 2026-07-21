// Persist aggregated provider records into the canonical Fighter/Event/Fight
// tables. Identity is resolved through the dedupe engine so the same fighter or
// card arriving from several sources lands on one row; provenance is recorded in
// the *ExternalId link tables when present.
//
// Provenance writes (ExternalId / Alias) are wrapped in best-effort try/catch so
// a database that hasn't run `db:push` for the additive models still gets the
// core enrichment (the visible fix) without throwing.

import { prisma } from "@/lib/db";
import { stripLocked } from "@/lib/admin/provenance";
import { slugify } from "@/lib/utils";
import { toCountryCode } from "@/lib/countries";
import { invalidate } from "@/lib/cache";
import { log } from "@/lib/scraper/logger";
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

// ─── fighters ────────────────────────────────────────────────────────────

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
      update: fill, // sport intentionally not updated — first source owns it
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
    /* additive table not migrated yet — core enrichment already applied */
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

// ─── events ──────────────────────────────────────────────────────────────

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

  const match = await resolveEvent({ source: ev._meta.source, externalId: ev.externalId, name: ev.name, sport, date: ev.date });

  const fill = defined({
    name: ev.name,
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
    const current = await prisma.event.findUnique({
      where: { id: match.eventId },
      select: { lockedFields: true },
    });
    const data = stripLocked(fill, current?.lockedFields ?? []);
    if (Object.keys(data).length > 0) {
      await prisma.event.update({ where: { id: match.eventId }, data });
    }
    eventId = match.eventId;
  } else {
    const slug = slugify(ev.name) || slugify(`${ev.name}-${ev.date.slice(0, 10)}`);
    const row = await prisma.event.upsert({
      where: { slug },
      update: fill,
      create: {
        slug, sport, name: ev.name,
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

  await invalidate(`event:${slugify(ev.name)}`);
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

/** Ensure a fighter row exists for a fight-stub corner; returns its id. */
async function ensureCornerFighter(
  sport: Sport,
  source: string,
  name: string,
  externalId: string | undefined,
): Promise<string | null> {
  if (!name?.trim()) return null;
  const match = await resolveFighter({ source, externalId, name, sport });
  if (match.fighterId) return match.fighterId;
  const slug = slugify(name);
  if (!slug) return null;
  const row = await prisma.fighter.upsert({
    where: { slug },
    update: {},
    create: { slug, sport, name },
  });
  if (externalId) {
    try {
      await prisma.fighterExternalId.upsert({
        where: { source_externalId: { source, externalId } },
        update: { fighterId: row.id },
        create: { fighterId: row.id, source, externalId, confidence: 0.8 },
      });
    } catch { /* not migrated */ }
  }
  return row.id;
}

async function upsertFight(
  sport: Sport,
  eventId: string,
  ev: NormalizedEvent,
  stub: NormalizedFightStub,
  index: number,
): Promise<void> {
  const redId = await ensureCornerFighter(sport, ev._meta.source, stub.redName, stub.redExternalId);
  const blueId = await ensureCornerFighter(sport, ev._meta.source, stub.blueName, stub.blueExternalId);
  if (!redId || !blueId) return;

  let weightClassId: string | undefined;
  if (stub.weightClass) {
    const wc = await prisma.weightClass.findFirst({
      where: { sport, name: { equals: stub.weightClass, mode: "insensitive" } },
      select: { id: true },
    });
    weightClassId = wc?.id;
  }

  let winnerId: string | undefined;
  if (stub.winnerExternalId) {
    if (stub.winnerExternalId === stub.redExternalId) winnerId = redId;
    else if (stub.winnerExternalId === stub.blueExternalId) winnerId = blueId;
  }

  const slug = slugify(`${ev.name}-${stub.redName}-vs-${stub.blueName}`);
  const date = new Date(ev.date);

  const data = defined({
    eventId,
    redId, blueId,
    weightClassId,
    scheduledRounds: stub.scheduledRounds,
    titleFight: stub.titleFight,
    mainEvent: stub.mainEvent,
    orderOnCard: stub.mainEvent ? 0 : index + 1,
    result: stub.result,
    method: stub.method,
    roundEnded: stub.roundEnded,
    winnerId,
    date,
  });

  // Same rule as events, and it matters most here: `orderOnCard` above is
  // rebuilt from the SOURCE's index every run, so an operator's drag-and-drop
  // ordering (and any early-entered result) would be destroyed by the next cron.
  const existing = await prisma.fight.findUnique({ where: { slug }, select: { id: true, lockedFields: true } });
  if (existing) {
    const update = stripLocked(data, existing.lockedFields);
    if (Object.keys(update).length > 0) {
      await prisma.fight.update({ where: { id: existing.id }, data: update });
    }
    return;
  }

  await prisma.fight.upsert({
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
      result: stub.result ?? "SCHEDULED",
      method: stub.method ?? null,
      roundEnded: stub.roundEnded ?? null,
      winnerId: winnerId ?? null,
      date,
    },
  });
}
