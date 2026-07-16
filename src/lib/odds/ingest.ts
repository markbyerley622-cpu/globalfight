// ════════════════════════════════════════════════════════════════════════
//  Upcoming-fights + odds ingestion (the canonical pipeline).
//
//  The licensed odds feed is our most reliable source of UPCOMING bouts, so it
//  drives the whole chain rather than being a leaf that drops data:
//
//      market feed → upsert fighters → upsert event → upsert fight → attach odds
//
//  Previously odds were discarded unless a matching fight already existed; now
//  the fight (and its fighters and a daily event card) are created on demand,
//  so the schedule, predictions and betting pages all populate automatically.
// ════════════════════════════════════════════════════════════════════════

import { prisma } from "@/lib/db";
import { slugify, impliedProbability } from "@/lib/utils";
import { invalidate } from "@/lib/cache";
import { log } from "@/lib/scraper/logger";
import { fetchMarketOdds, type MarketEvent, type SportLabel } from "./provider";

const SPORT_ENUM: Record<SportLabel, "BOXING" | "MMA" | "MUAY_THAI" | "KICKBOXING"> = {
  Boxing: "BOXING", MMA: "MMA", "Muay Thai": "MUAY_THAI", Kickboxing: "KICKBOXING",
};

const dateKey = (iso: string) => iso.slice(0, 10);            // YYYY-MM-DD (UTC)
const defaultRounds = (s: SportLabel) => (s === "Boxing" ? 12 : s === "MMA" ? 3 : 5);

/** Upsert a fighter by slug; sport is set on create only (never clobbered). */
async function upsertFighter(name: string, sport: SportLabel): Promise<string> {
  const slug = slugify(name);
  const f = await prisma.fighter.upsert({
    where: { slug },
    update: { name },                                  // refresh display name only
    create: { slug, name, sport: SPORT_ENUM[sport] },  // first source sets the sport
  });
  return f.id;
}

/** Upsert the synthetic daily event card for a sport+date. */
async function upsertEventCard(sport: SportLabel, day: string, earliest: Date): Promise<string> {
  const slug = `${sport.toLowerCase().replace(/\s+/g, "-")}-${day}`;
  const label = new Date(`${day}T00:00:00Z`).toLocaleDateString("en-GB", {
    day: "2-digit", month: "short", year: "numeric",
  });
  const e = await prisma.event.upsert({
    where: { slug },
    update: {},
    create: {
      slug, name: `${sport} — ${label}`, sport: SPORT_ENUM[sport],
      promotion: "Various", date: earliest, status: "SCHEDULED",
    },
  });
  return e.id;
}

/**
 * Pull the live market and persist it as fighters → events → fights → odds.
 * Returns the number of OddsSnapshot rows written.
 */
export async function ingestOdds(): Promise<number> {
  const events = await fetchMarketOdds();
  if (events.length === 0) return 0;

  // Group bouts into daily event cards per sport so the schedule is tidy.
  const groups = new Map<string, MarketEvent[]>();
  for (const ev of events) {
    const key = `${ev.sport}|${dateKey(ev.commenceTime)}`;
    (groups.get(key) ?? groups.set(key, []).get(key)!).push(ev);
  }

  let fightsWritten = 0;
  let oddsWritten = 0;

  for (const [key, bouts] of groups) {
    const [sport, day] = key.split("|") as [SportLabel, string];
    const earliest = new Date(Math.min(...bouts.map((b) => +new Date(b.commenceTime))));
    const eventId = await upsertEventCard(sport, day, earliest);

    // The bout with the most bookmakers is the de-facto main event.
    const mainIdx = bouts.reduce((best, b, i, arr) => (b.books.length > arr[best].books.length ? i : best), 0);

    for (let i = 0; i < bouts.length; i++) {
      const ev = bouts[i];
      const redId = await upsertFighter(ev.red, sport);
      const blueId = await upsertFighter(ev.blue, sport);
      const slug = `${slugify(ev.red)}-vs-${slugify(ev.blue)}`;

      const fight = await prisma.fight.upsert({
        where: { slug },
        update: { eventId, date: new Date(ev.commenceTime), orderOnCard: i, mainEvent: i === mainIdx },
        create: {
          slug, eventId, redId, blueId,
          date: new Date(ev.commenceTime), result: "SCHEDULED",
          scheduledRounds: defaultRounds(sport), orderOnCard: i, mainEvent: i === mainIdx,
        },
      });
      fightsWritten++;

      // Attach odds. fight.red === ev.red, so book prices map directly (no flip).
      for (const book of ev.books) {
        await prisma.oddsSnapshot.create({
          data: {
            fightId: fight.id, bookmaker: book.bookmaker,
            redOdds: book.redOdds, blueOdds: book.blueOdds, drawOdds: book.drawOdds ?? null,
            redImplied: impliedProbability(book.redOdds), blueImplied: impliedProbability(book.blueOdds),
          },
        });
        oddsWritten++;
      }
      await invalidate(`odds:${slug}`);
    }
  }

  await invalidate("events:upcoming");
  log.info({ events: events.length, fights: fightsWritten, snapshots: oddsWritten }, "odds:ingested");
  return oddsWritten;
}
