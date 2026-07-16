// Backfill fight cards + results from Wikipedia (CC BY-SA) for events that have
// no card yet. Promotion-agnostic.
//   node --import tsx scripts/run-wikicards.mts [limit] [promotionFilter]
import { prisma } from "../src/lib/db.ts";
import { isSourceEnabled } from "../src/lib/ingestion-registry.ts";
import { persistAggregated } from "../src/services/sync/persist.ts";
import { syncWikiCards } from "../src/lib/scraper/wikicard/index.ts";
import type { Sport } from "../src/lib/types.ts";
import type { WikiTarget } from "../src/lib/scraper/wikicard/types.ts";

const limit = Number(process.argv[2] ?? 25);
const promo = process.argv[3];

if (!isSourceEnabled("wikipedia-facts")) {
  console.error("wikipedia-facts is DISABLED in the ingestion registry — aborting.");
  process.exit(1);
}

// Events with NO card yet. Only PAST events: Wikipedia rarely has a page (let
// alone a results table) for an event that hasn't happened, so targeting future
// dates just burns requests for nothing.
const rows = await prisma.event.findMany({
  where: {
    fights: { none: {} },
    date: { lt: new Date() },
    ...(promo ? { promotion: { contains: promo, mode: "insensitive" } } : {}),
  },
  orderBy: { date: "desc" }, // most recent past first
  take: limit,
  select: { name: true, date: true, sport: true, promotion: true },
});
console.log(`past events missing a card: ${rows.length}${promo ? ` (promotion~${promo})` : ""}`);

const targets: WikiTarget[] = rows.map((r) => ({ name: r.name, date: r.date.toISOString(), sport: r.sport as Sport }));
const h = await syncWikiCards(targets);
console.log("wiki:", JSON.stringify(h.report));

// Persist grouped by sport (persistAggregated applies one sport per call).
const bySport = new Map<Sport, typeof h.events>();
for (const e of h.events) {
  const s = e.sport as Sport;
  if (!bySport.has(s)) bySport.set(s, []);
  bySport.get(s)!.push(e);
}
for (const [sport, evs] of bySport) {
  console.log(`persisted [${sport}]:`, await persistAggregated(sport, "events", evs));
}
await prisma.$disconnect();
