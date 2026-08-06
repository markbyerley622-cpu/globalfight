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
import { resolveOrCreateFighter } from "@/lib/registry/identity";
import { getEventAdapters } from "./registry";
import { notifyEventChanges, snapshotEvent } from "@/lib/social/event-triggers";
import { promotionFromText } from "@/lib/promotions";
import type { AdapterBout, AdapterEvent, SportEnum } from "./adapters/types";

function eventSlug(ev: AdapterEvent): string {
  const base = slugify(ev.name).slice(0, 60) || "event";
  return `${ev.sport.toLowerCase()}-${base}-${ev.date.slice(0, 10)}`;
}

// Professional (scripted) wrestling leaks into the Wikidata WRESTLING subtree
// (WWE/AEW PPVs like "Money in the Bank", "Worlds Collide"). It is not a combat
// sport — the news pipeline already drops it (see EXCLUDE in lib/news/ingest) —
// so we skip it here too rather than surface it as a "Various" wrestling event.
// Freestyle promotions (RAF etc.) don't match these tokens, so they're kept.
const PRO_WRESTLING =
  /\b(wwe|aew|nxt|tna|njpw|gcw|roh|wrestlemania|summerslam|royal rumble|survivor series|money in the bank|worlds collide|night of champions|crown jewel|elimination chamber|clash at the castle|saturday night'?s main event|wrestle kingdom|g1 climax|double or nothing|all out|full gear|forbidden door|all in\b|revolution)\b/i;

/**
 * The corner of a bout, as a CANONICAL fighter.
 *
 * Was `upsert({ where: { slug: slugify(name) } })`. This is the highest-volume
 * fighter-creation path in the product — every bout on every scraped card runs
 * through it twice — so it is also where a name-keyed identity did the most
 * damage: every spelling variant a promotion published became another fighter,
 * and every same-named pair across two sports became one.
 *
 * `update: { name }` was the other half of that: a later source could rewrite an
 * established fighter's display name to its own spelling. The resolver records
 * that variant as an ALIAS instead, which makes the next match easier rather
 * than overwriting the registry's own label.
 */
async function upsertFighter(name: string, sport: SportEnum): Promise<string | null> {
  const result = await resolveOrCreateFighter(
    { name, sport },
    { origin: "event-ingest", sportFallback: sport },
  );
  // Null = the string was parser junk, not a person. See lib/registry/artefacts.
  if (result.artefact) {
    log.warn({ name, reason: result.artefact.reason }, "ingest:name-artefact-skipped");
  }
  return result.fighterId;
}

async function upsertBout(eventId: string, sport: SportEnum, bout: AdapterBout, order: number, date: Date): Promise<void> {
  const redId = await upsertFighter(bout.red, sport);
  const blueId = await upsertFighter(bout.blue, sport);
  // A bout needs two people. If either corner was a table label rather than a
  // name, the row is dropped entirely — half a bout against a fighter called
  // "CHAMPION" is worse than no bout, and the warning above says which card.
  if (!redId || !blueId) return;
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
  if (PRO_WRESTLING.test(ev.name)) return 0;   // scripted wrestling — not a combat sport
  const slug = eventSlug(ev);

  // BEFORE the upsert. An upsert knows the row's new value and nothing about its
  // old one, so "this card was just announced" and "the main event changed" are
  // not observable from inside it — which is why those notifications did not
  // exist. Null here means the event is new, which is the announcement itself.
  const before = await snapshotEvent({ slug });

  // Prefer the adapter's promotion; otherwise try to read a known org out of the
  // event title ("UFC Fight Night: …" → "UFC") before settling for the neutral
  // "Various" placeholder. This is what stops most events showing the grey mark.
  const promotion = ev.promotion ?? promotionFromText(ev.name) ?? "Various";

  const event = await prisma.event.upsert({
    where: { slug },
    update: { date, venue: ev.venue ?? undefined, city: ev.city ?? undefined, country: ev.country ?? undefined, promotion },
    create: {
      slug, name: ev.name, sport: ev.sport,
      promotion,
      venue: ev.venue ?? null, city: ev.city ?? null, country: ev.country ?? null,
      date, status: "SCHEDULED",
    },
  });

  if (ev.bouts?.length) {
    for (let i = 0; i < ev.bouts.length; i++) {
      await upsertBout(event.id, ev.sport, ev.bouts[i], i, date);
    }
  }

  // The bouts are attached, so the diff sees the finished card rather than an
  // event that momentarily had none. Never throws — an ingested event is the fact
  // and the notification is a consequence.
  await notifyEventChanges(before, event.id);
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
