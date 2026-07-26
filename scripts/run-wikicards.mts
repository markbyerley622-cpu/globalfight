// Backfill fight cards + RESULTS from Wikipedia (CC BY-SA). Promotion-agnostic.
//
//   node --import tsx scripts/run-wikicards.mts [limit] [promotionFilter] [gap]
//
//   gap = results | cards | all   (default: all — results first)
//
// Two gaps exist, and only chasing one of them is what left completed cards on
// "Result pending" forever:
//   results — the card is there, the bouts have no outcome (the common case for
//             boxing/MMA events created ahead of time by the odds pipeline)
//   cards   — a past event with no bouts at all
//
// Target selection lives in src/lib/scraper/wikicard/targets.ts so this script
// and the cron runner ask the same question.
import { prisma } from "../src/lib/db.ts";
import { isSourceEnabled } from "../src/lib/ingestion-registry.ts";
import { persistAggregated } from "../src/services/sync/persist.ts";
import { syncWikiCards, findWikiTargets } from "../src/lib/scraper/wikicard/index.ts";
import type { Sport } from "../src/lib/types.ts";
import type { WikiGap } from "../src/lib/scraper/wikicard/targets.ts";

const limit = Number(process.argv[2] ?? 25);
const promo = process.argv[3];
const gapArg = process.argv[4];
const gap: WikiGap | undefined =
  gapArg === "results" ? "missing_result" : gapArg === "cards" ? "missing_card" : undefined;

if (!isSourceEnabled("wikipedia-facts")) {
  console.error("wikipedia-facts is DISABLED in the ingestion registry — aborting.");
  process.exit(1);
}

const targets = await findWikiTargets({ limit, promotion: promo, gap });
const pending = targets.filter((t) => t.gap === "missing_result");
console.log(
  `targets: ${targets.length}${promo ? ` (promotion~${promo})` : ""} — ` +
    `${pending.length} awaiting results, ${targets.length - pending.length} missing a card`,
);
for (const t of pending) console.log(`  pending: ${t.date.slice(0, 10)}  ${t.name}`);

if (!targets.length) {
  await prisma.$disconnect();
  process.exit(0);
}

const h = await syncWikiCards(
  targets.map((t) => ({ name: t.name, date: t.date, sport: t.sport })),
);
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
