// Matchroom Boxing — the FORWARD schedule.
//
//   npm run backfill:matchroom -- --dry-run
//   npm run backfill:matchroom                    # upcoming cards only
//   npm run backfill:matchroom -- --max=40        # bound one run
//   npm run backfill:matchroom -- --include-past  # rarely wanted; see below
//
// Boxing held ONE upcoming event against 149 historical, because the Wikipedia
// category provider is retrospective by nature — a per-fight article is written
// around or after the fight. Predictions, reminders, notifications and every
// retention loop consume the SCHEDULE, so this closes the gap that mattered.
//
// Upcoming-only by default: re-scraping history from a source that publishes
// less of it than Wikipedia would spend hundreds of requests to add nothing.
//
// Persists through persistAggregated like every other provider, so identity
// resolution, the entity-normalising chokepoint and result integrity all apply.
import { syncMatchroom } from "../src/lib/scraper/matchroom/sync.ts";
import { persistAggregated } from "../src/services/sync/persist.ts";
import { prisma } from "../src/lib/db.ts";

const argv = process.argv.slice(2);
const flag = (n: string) => argv.includes(`--${n}`);
const DRY = flag("dry-run");
const maxEvents = Number.parseInt(argv.find((a) => a.startsWith("--max="))?.slice(6) ?? "", 10) || undefined;

async function main() {
  console.log(`\n  Matchroom forward schedule — ${DRY ? "DRY RUN" : "WRITING"}\n`);

  const [beforeEvents, beforeBouts] = await Promise.all([
    prisma.event.count({ where: { sport: "BOXING", date: { gte: new Date() } } }),
    prisma.fight.count({ where: { result: "SCHEDULED", event: { sport: "BOXING", date: { gte: new Date() } } } }),
  ]);

  // RESUMABLE: URLs already ingested are skipped before a request is spent.
  const seen = await prisma.eventExternalId.findMany({
    where: { source: "matchroom" },
    select: { externalId: true },
  });
  const skipUrls = new Set(
    seen.map((e) => `https://www.matchroomboxing.com${e.externalId.replace(/^matchroom:/, "")}/`),
  );
  if (skipUrls.size) console.log(`  ${skipUrls.size} card(s) already ingested — skipped without a request\n`);

  const { events, report } = await syncMatchroom({
    includePast: flag("include-past"),
    maxEvents,
    skipUrls,
    onProgress: (l) => console.log(l),
  });

  console.log(`\n  ── Harvest ────────────────────────────────────────────`);
  console.log(`  URLs discovered   ${report.discovered}`);
  console.log(`  pages fetched     ${report.fetched}`);
  console.log(`  already ingested  ${report.skipped}`);
  console.log(`  cards             ${events.length}`);
  console.log(`  bouts             ${report.bouts}`);
  if (report.unusable.length) {
    const by = new Map<string, number>();
    for (const u of report.unusable) by.set(u.why, (by.get(u.why) ?? 0) + 1);
    console.log(`  unusable          ${report.unusable.length}`);
    for (const [why, n] of [...by].sort((a, b) => b[1] - a[1])) {
      console.log(`      ${String(n).padStart(4)}  ${why}`);
    }
  }
  for (const w of report.warnings.slice(0, 8)) console.log(`  !  ${w}`);

  if (DRY) { console.log(`\n  DRY RUN — nothing written.\n`); return; }

  const written = await persistAggregated("BOXING", "events", events);
  const [afterEvents, afterBouts] = await Promise.all([
    prisma.event.count({ where: { sport: "BOXING", date: { gte: new Date() } } }),
    prisma.fight.count({ where: { result: "SCHEDULED", event: { sport: "BOXING", date: { gte: new Date() } } } }),
  ]);

  console.log(`\n  ── Written ────────────────────────────────────────────`);
  console.log(`  events written            ${written}`);
  console.log(`  UPCOMING boxing events    ${beforeEvents} -> ${afterEvents}`);
  console.log(`  UPCOMING boxing bouts     ${beforeBouts} -> ${afterBouts}\n`);
}

try {
  await main();
} finally {
  await prisma.$disconnect();
}
