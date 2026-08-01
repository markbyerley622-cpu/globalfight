// Historical cards for promotions whose only structured source is their
// Wikipedia event index.
//
//   npm run backfill:misfits                      # everything not yet ingested
//   npm run backfill:misfits -- --max-cards=10    # bounded slice; rerun to continue
//   npm run backfill:misfits -- --refresh         # re-fetch cards we already hold
//   npm run backfill:misfits -- --dry-run
//
// RESUMABLE AND IDEMPOTENT.
//   • The skip set is built from EventExternalId, so a card already ingested is
//     never re-fetched. An interrupted run resumes exactly where it stopped and
//     a finished one costs a single request for the index.
//   • Writes go through persistAggregated, where fight identity is the corner
//     pair on the event — so a rerun updates instead of duplicating, and a run
//     that died mid-write leaves valid rows that the next run simply skips.
//   • --refresh ignores the skip set, for when a card's article has since gained
//     its results table.
import { prisma } from "../src/lib/db.ts";
import { persistAggregated } from "../src/services/sync/persist.ts";
import {
  syncPromotionIndex, articleFromExternalId, INDEX_SOURCE,
  PROMOTION_INDEX_SOURCES, type PromotionIndexSource,
} from "../src/lib/scraper/promotion-index/index.ts";
import type { NormalizedEvent } from "../src/services/providers/types.ts";
import type { Sport } from "../src/lib/types.ts";

const argv = process.argv.slice(2);
const flag = (n: string) => argv.includes(`--${n}`);
const value = (n: string): string | undefined => {
  const inline = argv.find((a) => a.startsWith(`--${n}=`));
  if (inline) return inline.slice(n.length + 3);
  const i = argv.indexOf(`--${n}`);
  if (i < 0) return undefined;
  const parts: string[] = [];
  for (let j = i + 1; j < argv.length && !argv[j].startsWith("--"); j++) parts.push(argv[j]);
  return parts.length ? parts.join(" ") : undefined;
};

const requested = (value("promotion") ?? "all").split(/[,\s]+/).map((s) => s.trim().toLowerCase()).filter(Boolean);
const sources: PromotionIndexSource[] = requested.includes("all")
  // `--promotion=all` skips disabled sources; naming one explicitly still runs it,
  // so a disabled source can be re-probed without editing config.
  ? PROMOTION_INDEX_SOURCES.filter((s) => !s.disabled)
  : PROMOTION_INDEX_SOURCES.filter((s) => requested.includes(s.key));
if (!sources.length) {
  console.error(`unknown promotion. known: ${PROMOTION_INDEX_SOURCES.map((s) => s.key).join(", ")}, all`);
  process.exit(1);
}

const dryRun = flag("dry-run");
const refresh = flag("refresh");
const maxCards = Number(value("max-cards") ?? Number.POSITIVE_INFINITY);

const [conn] = await prisma.$queryRaw<{ db: string }[]>`SELECT current_database() AS db`;
console.log(`database   : ${conn.db}`);
console.log(`promotions : ${sources.map((s) => s.key).join(", ")}`);
console.log(`mode       : ${refresh ? "REFRESH (ignore skip set)" : "resume (skip ingested)"}${dryRun ? "   DRY RUN" : ""}`);
if (Number.isFinite(maxCards)) console.log(`max cards  : ${maxCards}`);

// ── resume point ────────────────────────────────────────────────────────────
const ingested = await prisma.eventExternalId.findMany({
  where: { source: INDEX_SOURCE },
  select: { externalId: true },
});
const skipArticles = new Set(
  refresh ? [] : ingested.map((r) => articleFromExternalId(r.externalId)).filter((a): a is string => a !== null),
);
console.log(`already held : ${ingested.length} card(s)${refresh ? " (ignored)" : " — these will not be re-fetched"}`);

const before = await prisma.event.count({ where: { promotion: { in: sources.map((s) => s.promotion) } } });
const boutsBefore = await prisma.fight.count({ where: { event: { promotion: { in: sources.map((s) => s.promotion) } } } });

console.log("\n── harvesting ──────────────────────────────────────────────────");
const { events, report } = await syncPromotionIndex({
  sources, skipArticles, maxCards, onProgress: (l) => console.log(l),
});

console.log("\n── source coverage ─────────────────────────────────────────────");
console.log(`  index rows listed      : ${report.indexRows}`);
console.log(`  card articles fetched  : ${report.cardsFetched}`);
console.log(`  skipped (already held) : ${report.cardsSkipped}`);
console.log(`  bouts parsed           : ${report.bouts}`);
console.log(`  cards assembled        : ${events.length}`);

if (report.unusable.length) {
  const by = new Map<string, number>();
  for (const u of report.unusable) by.set(u.why, (by.get(u.why) ?? 0) + 1);
  console.log("\n  index rows not usable — each cause is a DIFFERENT problem:");
  for (const [why, n] of [...by].sort((a, b) => b[1] - a[1])) {
    const kind = why === "no results table" ? "SOURCE (card not written up yet)"
      : why === "no article linked" ? "SOURCE (no article exists)"
      : why === "article not found" ? "SOURCE (link is a red link)"
      : why === "no date in the index" ? "SOURCE (index row has no date)"
      // Not a source limit: the source HAS a page, it just covers several cards
      // at once and cannot be split back apart from here.
      : "SOURCE (one article covers several cards — not attributable)";
    console.log(`    ${String(n).padStart(4)}  ${why.padEnd(22)} ${kind}`);
  }
  for (const u of report.unusable.slice(0, 8)) console.log(`          ${u.name} — ${u.why}`);
}
if (report.warnings.length) {
  console.log(`\n  ⚠ ${report.warnings.length} fetch warning(s):`);
  for (const w of report.warnings.slice(0, 8)) console.log(`      ${w}`);
}

if (dryRun) {
  console.log("\n── would write ─────────────────────────────────────────────────");
  for (const ev of events.slice(0, 30)) {
    const dec = (ev.fights ?? []).filter((f) => f.result !== "SCHEDULED").length;
    console.log(`  ${ev.date.slice(0, 10)}  ${String(ev.fights?.length ?? 0).padStart(3)} bouts (${dec} decided)  ${ev.name}`);
  }
  await prisma.$disconnect();
  process.exit(0);
}

console.log("\n── writing ─────────────────────────────────────────────────────");
const bySport = new Map<Sport, NormalizedEvent[]>();
for (const ev of events) {
  if (!bySport.has(ev.sport)) bySport.set(ev.sport, []);
  bySport.get(ev.sport)!.push(ev);
}
let written = 0;
for (const [sport, list] of bySport) {
  const n = await persistAggregated(sport, "events", list);
  written += n;
  console.log(`  ${sport.padEnd(10)} ${String(n).padStart(3)}/${String(list.length).padStart(3)} events persisted`);
}

const after = await prisma.event.count({ where: { promotion: { in: sources.map((s) => s.promotion) } } });
const boutsAfter = await prisma.fight.count({ where: { event: { promotion: { in: sources.map((s) => s.promotion) } } } });
const decidedAfter = await prisma.fight.count({
  where: { event: { promotion: { in: sources.map((s) => s.promotion) } }, result: { not: "SCHEDULED" } },
});

console.log("\n── net ─────────────────────────────────────────────────────────");
console.log(`  events   ${before} → ${after}  (+${after - before})`);
console.log(`  bouts    ${boutsBefore} → ${boutsAfter}  (+${boutsAfter - boutsBefore})`);
console.log(`  decided  ${decidedAfter}`);
console.log(`  (${written} event upserts reported by the persistence layer)`);
if (events.length > 0 && written === 0) {
  console.log("\n  ✗ HARVEST OK, WRITES FAILED — see the warn-level log from persistAggregated.");
}
console.log("\n  Rerun is safe and cheap: ingested cards are skipped without a request.");

await prisma.$disconnect();
