// ════════════════════════════════════════════════════════════════════════
//  Multi-sport event ingestion.
//
//  Runs every configured event adapter and persists the results into the same
//  Event/Fight/Fighter schema the Odds pipeline uses, so the schedule, event
//  pages and sport filters populate for all disciplines — not just Boxing/MMA.
//  Self-bootstrapping: an event (and any named bouts + fighters) is created on
//  demand. Idempotent via a stable slug derived from the source UID.
// ════════════════════════════════════════════════════════════════════════

import { prisma } from "@/lib/db";
import { slugify } from "@/lib/utils";
import { invalidate } from "@/lib/cache";
import { log } from "@/lib/scraper/logger";
import { getEventAdapters } from "./registry";
import type { AdapterBout, AdapterEvent, SportEnum } from "./adapters/types";

function eventSlug(ev: AdapterEvent): string {
  const base = slugify(ev.name).slice(0, 60) || "event";
  return `${ev.sport.toLowerCase()}-${base}-${ev.date.slice(0, 10)}`;
}

async function upsertFighter(name: string, sport: SportEnum): Promise<string> {
  const slug = slugify(name);
  const f = await prisma.fighter.upsert({
    where: { slug },
    update: { name },
    create: { slug, name, sport },
  });
  return f.id;
}

async function upsertBout(eventId: string, sport: SportEnum, bout: AdapterBout, order: number, date: Date): Promise<void> {
  const redId = await upsertFighter(bout.red, sport);
  const blueId = await upsertFighter(bout.blue, sport);
  const slug = `${slugify(bout.red)}-vs-${slugify(bout.blue)}`;
  await prisma.fight.upsert({
    where: { slug },
    update: { eventId, date, orderOnCard: order, mainEvent: order === 0 },
    create: {
      slug, eventId, redId, blueId, date, result: "SCHEDULED",
      scheduledRounds: 3, orderOnCard: order, mainEvent: order === 0,
    },
  });
}

/** Persist one adapter event. Returns 1 if an event row was written. */
async function upsertAdapterEvent(ev: AdapterEvent): Promise<number> {
  const date = new Date(ev.date);
  if (Number.isNaN(+date)) return 0;
  const slug = eventSlug(ev);

  const event = await prisma.event.upsert({
    where: { slug },
    update: { date, venue: ev.venue ?? undefined, city: ev.city ?? undefined, country: ev.country ?? undefined },
    create: {
      slug, name: ev.name, sport: ev.sport,
      promotion: ev.promotion ?? "Various",
      venue: ev.venue ?? null, city: ev.city ?? null, country: ev.country ?? null,
      date, status: "SCHEDULED",
    },
  });

  if (ev.bouts?.length) {
    for (let i = 0; i < ev.bouts.length; i++) {
      await upsertBout(event.id, ev.sport, ev.bouts[i], i, date);
    }
  }
  return 1;
}

/** Run all configured adapters. Returns the number of events written. */
export async function ingestAdapterEvents(): Promise<number> {
  const adapters = getEventAdapters();
  if (adapters.length === 0) {
    log.info({}, "events:no-adapters-configured");
    return 0;
  }

  let written = 0;
  for (const adapter of adapters) {
    try {
      const events = await adapter.fetch();
      for (const ev of events) written += await upsertAdapterEvent(ev);
      log.info({ adapter: adapter.key, sport: adapter.sport, events: events.length }, "events:adapter-done");
    } catch (e) {
      log.warn({ adapter: adapter.key, err: (e as Error).message }, "events:adapter-failed");
    }
  }

  if (written) {
    await invalidate("events:upcoming");
  }
  return written;
}
