// Cards for promotions that have NO per-card article — every card they ran in a
// season is written up on one year round-up page, split back apart here.
//
//   npm run backfill:year -- --promotion=glory              # all years
//   npm run backfill:year -- --promotion=one --years=2024-2026
//   npm run backfill:year -- --promotion=all --dry-run
//
// WHY THIS EXISTS
//   ONE Championship has 382 cards with zero bouts and kickboxing has zero events,
//   both for the same reason: the two existing paths correctly REFUSE a year page.
//   wikicard's verifier rejects it (a year page is not the card) and the index
//   path's shared-article guard refuses every row pointing at it (otherwise each
//   card claims the whole season). Neither guard was loosened — see year-split.ts.
//
// FILLS RATHER THAN DUPLICATES
//   persistAggregated identifies an event by slugify(name), and our ONE rows are
//   named for the billing while the round-up names them for the headline. Emitting
//   the upstream name would create a second event beside the empty one. So each
//   section is matched to an existing row on (designation, exact date) and emitted
//   under the name we already store. --dry-run reports that split before writing.
//
// RESUMABLE AND IDEMPOTENT: fight identity is the corner pair on the event, so a
// rerun updates in place; an interrupted run leaves valid rows.
import { prisma } from "../src/lib/db.ts";
import { persistAggregated } from "../src/services/sync/persist.ts";
import {
  syncYearPages, eventMatchKey, YEAR_PAGE_SOURCES, type YearPageSource,
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
  const next = argv[i + 1];
  return next && !next.startsWith("--") ? next : undefined;
};

const requested = (value("promotion") ?? "all").split(/[,\s]+/).map((s) => s.trim().toLowerCase()).filter(Boolean);
const sources: YearPageSource[] = requested.includes("all")
  ? YEAR_PAGE_SOURCES
  : YEAR_PAGE_SOURCES.filter((s) => requested.includes(s.key));
if (!sources.length) {
  console.error(`unknown promotion. known: ${YEAR_PAGE_SOURCES.map((s) => s.key).join(", ")}, all`);
  process.exit(1);
}

const thisYear = new Date().getFullYear();
const yearsArg = value("years");
let years: number[];
if (yearsArg) {
  const m = /^(\d{4})(?:\s*[-–]\s*(\d{4}))?$/.exec(yearsArg.trim());
  if (!m) { console.error(`--years must be YYYY or YYYY-YYYY, got "${yearsArg}"`); process.exit(1); }
  const from = Number(m[1]);
  const to = Number(m[2] ?? m[1]);
  years = Array.from({ length: to - from + 1 }, (_, i) => from + i);
} else {
  const earliest = Math.min(...sources.map((s) => s.firstYear));
  years = Array.from({ length: thisYear - earliest + 1 }, (_, i) => earliest + i);
}

const dryRun = flag("dry-run");

const [conn] = await prisma.$queryRaw<{ db: string }[]>`SELECT current_database() AS db`;
console.log(`database   : ${conn.db}`);
console.log(`promotions : ${sources.map((s) => s.key).join(", ")}`);
console.log(`years      : ${years[0]}–${years[years.length - 1]} (${years.length})`);
if (dryRun) console.log("mode       : DRY RUN — nothing is written");

// ── what we already hold, for fill-vs-create ────────────────────────────────
//
// Indexed by designation + exact date. Both halves are required: the designation
// alone is not unique enough to write to, and matching the wrong row would move
// bouts onto someone else's card.
const existing = await prisma.event.findMany({
  where: { promotion: { in: sources.map((s) => s.promotion) } },
  select: { name: true, date: true, _count: { select: { fights: true } } },
});
const byKey = new Map<string, { name: string; bouts: number }>();
for (const e of existing) {
  byKey.set(`${eventMatchKey(e.name)}@${e.date.toISOString().slice(0, 10)}`, {
    name: e.name,
    bouts: e._count.fights,
  });
}
const emptyBefore = existing.filter((e) => e._count.fights === 0).length;
console.log(`already held : ${existing.length} event(s), ${emptyBefore} with NO bouts`);

/**
 * Look up a card, tolerating a one-day skew.
 *
 * A card in Bangkok stored as UTC can land a day either side of how the round-up
 * dates it. Widening the window is only safe because the DESIGNATION must match
 * too — two different cards sharing "one friday fights 164" one day apart does
 * not happen, whereas silently creating a second copy of one that does exist is
 * the failure this whole path is meant to avoid.
 *
 * Verified 2026-08-02: every ONE row we already hold matched on the exact date,
 * so this is insurance, not the mechanism.
 */
const shift = (iso: string, days: number): string => {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};
const lookup = (name: string, iso: string): { name: string; bouts: number } | undefined => {
  const key = eventMatchKey(name);
  for (const delta of [0, -1, 1]) {
    const hit = byKey.get(`${key}@${shift(iso.slice(0, 10), delta)}`);
    if (hit) return hit;
  }
  return undefined;
};

const boutsBefore = await prisma.fight.count({
  where: { event: { promotion: { in: sources.map((s) => s.promotion) } } },
});

console.log("\n── harvesting ──────────────────────────────────────────────────");
const { events, report } = await syncYearPages({
  sources,
  years,
  onProgress: (l) => console.log(l),
  resolveStored: (k) => lookup(k.name, k.date)?.name ?? null,
});

console.log("\n── source coverage ─────────────────────────────────────────────");
console.log(`  year pages fetched    : ${report.pagesFetched}`);
console.log(`  year pages absent     : ${report.pagesMissing}   (promotion did not run, or not written up)`);
console.log(`  cards split out       : ${report.sections}`);
console.log(`  bouts parsed          : ${report.bouts}`);
console.log(`  fills existing card   : ${report.matchedExisting}`);
console.log(`  new card              : ${report.newCards}`);

if (report.unusable.length) {
  const by = new Map<string, number>();
  for (const u of report.unusable) by.set(u.why, (by.get(u.why) ?? 0) + 1);
  console.log("\n  sections not usable — each cause is a DIFFERENT problem:");
  for (const [why, n] of [...by].sort((a, b) => b[1] - a[1])) console.log(`    ${String(n).padStart(4)}  ${why}`);
  for (const u of report.unusable.slice(0, 8)) console.log(`          ${u.name} — ${u.why}`);
}
if (report.warnings.length) {
  console.log(`\n  ⚠ ${report.warnings.length} fetch warning(s):`);
  for (const w of report.warnings.slice(0, 8)) console.log(`      ${w}`);
}

if (dryRun) {
  console.log("\n── would write ─────────────────────────────────────────────────");
  for (const ev of events.slice(0, 40)) {
    const dec = (ev.fights ?? []).filter((f) => f.result !== "SCHEDULED").length;
    const held = lookup(ev.name, ev.date);
    const tag = held ? (held.bouts === 0 ? "FILLS EMPTY" : `updates (${held.bouts}b)`) : "NEW";
    console.log(`  ${ev.date.slice(0, 10)}  ${String(ev.fights?.length ?? 0).padStart(3)}b (${String(dec).padStart(3)} dec)  ${tag.padEnd(14)} ${ev.name}`);
  }
  if (events.length > 40) console.log(`  … and ${events.length - 40} more`);
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
  console.log(`  ${sport.padEnd(10)} ${String(n).padStart(4)}/${String(list.length).padStart(4)} events persisted`);
}

const after = await prisma.event.findMany({
  where: { promotion: { in: sources.map((s) => s.promotion) } },
  select: { _count: { select: { fights: true } } },
});
const boutsAfter = await prisma.fight.count({
  where: { event: { promotion: { in: sources.map((s) => s.promotion) } } },
});
const decidedAfter = await prisma.fight.count({
  where: { event: { promotion: { in: sources.map((s) => s.promotion) } }, result: { not: "SCHEDULED" } },
});

console.log("\n── net ─────────────────────────────────────────────────────────");
console.log(`  events        ${existing.length} → ${after.length}  (+${after.length - existing.length})`);
console.log(`  empty cards   ${emptyBefore} → ${after.filter((e) => e._count.fights === 0).length}`);
console.log(`  bouts         ${boutsBefore} → ${boutsAfter}  (+${boutsAfter - boutsBefore})`);
console.log(`  decided       ${decidedAfter}`);
console.log(`  (${written} event upserts reported by the persistence layer)`);
if (events.length > 0 && written === 0) {
  console.log("\n  ✗ HARVEST OK, WRITES FAILED — see the warn-level log from persistAggregated.");
}

await prisma.$disconnect();
