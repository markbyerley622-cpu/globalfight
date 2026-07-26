// Production data-integrity audit for Wikipedia-sourced bouts. READ-ONLY.
//
//   npm run audit:wikicards
//   npm run audit:wikicards -- --since 2026-07-27T00:00:00Z   # scope to a known run
//   npm run audit:wikicards -- --event boxing-2026-07-26      # one event, in full
//   npm run audit:wikicards -- --min 10 --verbose
//
// Answers one question with measurements, not assumptions: did the historical repair
// attach bouts from unrelated cards to an event? A real card is 10-14 bouts; a
// Wikipedia season page carries a year of them.
import { prisma } from "../src/lib/db.ts";
import {
  auditWikicards, auditEventBySlug, NORMAL_MAX, REVIEW_MAX,
  type EventAudit,
} from "../src/lib/scraper/wikicard/audit.ts";

const argv = process.argv.slice(2);
const val = (n: string) => { const i = argv.indexOf(`--${n}`); return i >= 0 ? argv[i + 1] : undefined; };
const verbose = argv.includes("--verbose");
const since = val("since") ? new Date(val("since")!) : undefined;
const eventSlug = val("event");
const minBouts = val("min") ? Number(val("min")) : undefined;

const [conn] = await prisma.$queryRaw<{ db: string }[]>`SELECT current_database() AS db`;
console.log(`database : ${conn.db}`);
if (since) console.log(`window   : bouts created on/after ${since.toISOString()}`);
console.log(`bands    : ≤${NORMAL_MAX} normal · ${NORMAL_MAX + 1}-${REVIEW_MAX} review · >${REVIEW_MAX} CONTAMINATED\n`);

const audits: EventAudit[] = eventSlug
  ? [await auditEventBySlug(eventSlug, { since, minBouts: 0 })].filter(Boolean) as EventAudit[]
  : await auditWikicards({ since, minBouts });

if (!audits.length) {
  console.log("✓ No event exceeds the normal card size. Nothing to review.");
  const total = await prisma.fight.count();
  const events = await prisma.event.count({ where: { fights: { some: {} } } });
  console.log(`  (${total} bouts across ${events} events with cards)`);
  await prisma.$disconnect();
  process.exit(0);
}

const icon = { normal: "✓", review: "⚠", contaminated: "🚨" } as const;
let contaminated = 0, review = 0, suspectTotal = 0, protectedTotal = 0;

for (const a of audits) {
  if (a.verdict === "contaminated") contaminated += 1;
  if (a.verdict === "review") review += 1;
  suspectTotal += a.suspectCount;
  protectedTotal += a.protectedCount;

  console.log(`${icon[a.verdict]} ${a.boutCount} bouts — ${a.name}`);
  console.log(`    id=${a.id} slug=${a.slug} promotion=${a.promotion ?? "—"} date=${a.date.slice(0, 10)}`);
  if (a.wikiRefs.length) console.log(`    wikipedia page(s): ${a.wikiRefs.join(" · ")}`);
  else console.log("    wikipedia page(s): — (no provenance recorded; audited on slug shape)");
  console.log(`    suspect=${a.suspectCount}  protected-by-references=${a.protectedCount}  keep=${a.boutCount - a.suspectCount}`);

  if (verbose || a.verdict === "contaminated") {
    for (const b of a.bouts.slice(0, verbose ? a.bouts.length : 12)) {
      const mark = b.suspect ? "  SUSPECT" : "  keep   ";
      const prov = b.source ? `${b.source}${b.sourceRef ? `:"${b.sourceRef}"` : ""}` : "no-provenance";
      console.log(`    ${mark} ${b.red} vs ${b.blue}  [${b.result}] ${prov}`);
      if (!b.suspect && b.keepReason) console.log(`             ↳ ${b.keepReason}`);
    }
    if (!verbose && a.bouts.length > 12) console.log(`    … ${a.bouts.length - 12} more (use --verbose)`);
  }
  console.log("");
}

console.log("── summary ─────────────────────────────────────────────────");
console.log(`  events audited      : ${audits.length}`);
console.log(`  🚨 contaminated     : ${contaminated}`);
console.log(`  ⚠ review            : ${review}`);
console.log(`  suspect bouts       : ${suspectTotal}   (removable — nothing depends on them)`);
console.log(`  protected bouts     : ${protectedTotal}   (look imported, but carry picks/battles/odds — never removed)`);

if (suspectTotal > 0) {
  console.log("\n  Next: npm run cleanup:wikicards          (dry run, writes nothing)");
  console.log("        npm run cleanup:wikicards -- --apply (after reading the dry run)");
} else {
  console.log("\n  ✓ Nothing removable. Any oversized card here is either genuine or protected.");
}

await prisma.$disconnect();
