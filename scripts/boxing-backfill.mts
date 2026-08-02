// Boxing coverage, from Wikipedia's per-year fight categories.
//
//   npm run backfill:boxing -- --dry-run              # discover + parse, write nothing
//   npm run backfill:boxing                           # all years from firstYear
//   npm run backfill:boxing -- --years=2023-2026
//   npm run backfill:boxing -- --max=25               # bound one run
//
// WHY THIS EXISTS
//   Boxing was the platform's largest gap: 20 events against 573 MMA, 8 with
//   bouts, and Canelo/Crawford/Usyk/Inoue present only as surname-only ranking
//   stubs with no fights at all. There was no boxing event provider, so there
//   was nothing to fix in an importer — the source had to be built first.
//
// It persists through persistAggregated, the SAME path every other provider
// uses: identity resolution, the entity-normalizing chokepoint, result
// integrity and settlement all apply unchanged. This script owns no writes of
// its own.
import { syncBoxing } from "../src/lib/scraper/boxing/sync.ts";
import { CATEGORY_SOURCES, categorySourceFor } from "../src/lib/scraper/boxing/config.ts";
import { persistAggregated } from "../src/services/sync/persist.ts";
import { prisma } from "../src/lib/db.ts";

const argv = process.argv.slice(2);
const flag = (n: string) => argv.includes(`--${n}`);
const value = (n: string): string | undefined => {
  const inline = argv.find((a) => a.startsWith(`--${n}=`));
  if (inline) return inline.slice(n.length + 3);
  const i = argv.indexOf(`--${n}`);
  const next = argv[i + 1];
  return i >= 0 && next && !next.startsWith("--") ? next : undefined;
};

const DRY = flag("dry-run");
const maxCards = Number.parseInt(value("max") ?? "", 10) || undefined;

const requested = (value("promotion") ?? "boxing").toLowerCase();
const source = categorySourceFor(requested) ?? CATEGORY_SOURCES[0];

const thisYear = new Date().getUTCFullYear();
let years: number[];
const yearsArg = value("years");
if (yearsArg) {
  const m = /^(\d{4})(?:\s*[-–]\s*(\d{4}))?$/.exec(yearsArg.trim());
  if (!m) { console.error(`--years must be YYYY or YYYY-YYYY, got "${yearsArg}"`); process.exit(1); }
  const from = Number(m[1]);
  const to = Number(m[2] ?? m[1]);
  years = Array.from({ length: to - from + 1 }, (_, i) => from + i);
} else {
  // +1: next year's category exists as soon as a card is announced for it.
  years = Array.from({ length: thisYear + 1 - source.firstYear + 1 }, (_, i) => source.firstYear + i);
}

async function main() {
  console.log(`\n  Boxing backfill — ${DRY ? "DRY RUN" : "WRITING"}  years ${years[0]}–${years[years.length - 1]}\n`);

  // RESUMABLE: article titles already ingested are skipped before a request.
  const existing = await prisma.eventExternalId.findMany({
    where: { source: "wikipedia-category" },
    select: { externalId: true },
  });
  const skipArticles = new Set(
    existing.map((e) => e.externalId).filter((id) => id.startsWith("wp-cat:")).map((id) => id.slice("wp-cat:".length)),
  );
  if (skipArticles.size) console.log(`  ${skipArticles.size} card(s) already ingested — skipping without a request\n`);

  const before = await prisma.event.count({ where: { sport: "BOXING" } });
  const boutsBefore = await prisma.fight.count({ where: { event: { sport: "BOXING" } } });

  const { events, report } = await syncBoxing({
    sources: [source],
    years,
    skipArticles,
    maxCards,
    onProgress: (l) => console.log(l),
  });

  console.log(`\n  ── Harvest ────────────────────────────────────────────`);
  console.log(`  categories read     ${report.categoriesRead}`);
  console.log(`  articles discovered ${report.discovered}`);
  console.log(`  cards fetched       ${report.cardsFetched}`);
  console.log(`  cards skipped       ${report.cardsSkipped}`);
  console.log(`  events parsed       ${events.length}`);
  console.log(`  bouts parsed        ${report.bouts}`);

  if (report.unusable.length) {
    const byReason = new Map<string, number>();
    for (const u of report.unusable) byReason.set(u.why, (byReason.get(u.why) ?? 0) + 1);
    console.log(`  unusable            ${report.unusable.length}`);
    for (const [why, n] of byReason) console.log(`      ${n.toString().padStart(3)}  ${why}`);
  }
  for (const w of report.warnings.slice(0, 10)) console.log(`  !  ${w}`);

  if (DRY) {
    console.log(`\n  DRY RUN — nothing written.\n`);
    return;
  }

  const written = await persistAggregated("BOXING", "events", events);

  const after = await prisma.event.count({ where: { sport: "BOXING" } });
  const boutsAfter = await prisma.fight.count({ where: { event: { sport: "BOXING" } } });

  console.log(`\n  ── Written ────────────────────────────────────────────`);
  console.log(`  events written      ${written}`);
  console.log(`  boxing events       ${before} -> ${after}`);
  console.log(`  boxing bouts        ${boutsBefore} -> ${boutsAfter}`);
  console.log("");
}

try {
  await main();
} finally {
  await prisma.$disconnect();
}
