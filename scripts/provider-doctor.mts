// Provider dashboard, in the terminal.
//
//   npm run audit:providers
//   npm run audit:providers -- --json
//
// "Is anything still ingesting, and when did it last actually write?" Read-only.
// Renders lib/admin/provider-health — the same module /admin/providers uses — so
// the terminal and the dashboard can never disagree.
//
// The column that matters is LAST WRITE. A provider is not healthy because its
// cron returned 200; it is healthy because a row changed. The results pipeline
// was dead in production for weeks while every job reported success, because
// nothing was checking the second thing.
import { getProviderHealth, type ProviderState } from "../src/lib/admin/provider-health.ts";
import { prisma } from "../src/lib/db.ts";

const asJson = process.argv.includes("--json");
const report = await getProviderHealth();

if (asJson) {
  process.stdout.write(JSON.stringify(report, null, 2) + "\n");
  await prisma.$disconnect();
  process.exit(0);
}

const pad = (s: string | number, w: number) => String(s).padEnd(w);
const num = (s: string | number, w: number) => String(s).padStart(w);

// Ordered worst-first: the reason to open this is to find what broke.
const RANK: Record<ProviderState, number> = {
  "never-run": 0, silent: 1, stale: 2, disabled: 3, healthy: 4,
};

process.stdout.write(`\nPROVIDER HEALTH — ${report.generatedAt.slice(0, 19)}Z\n`);
process.stdout.write(`${"═".repeat(96)}\n`);
process.stdout.write(`ENABLE_SCRAPER=${report.scraperEnabled}   PROVIDER_BACKFILL_ENABLED=${report.backfillEnabled}\n`);
if (!report.scraperEnabled) {
  process.stdout.write(
    `\n  !! ENABLE_SCRAPER is off. Nothing below reaches the network, whatever its state says.\n` +
    `     Bout RESULTS in particular stop updating entirely — Wikipedia is the only source that carries them.\n`,
  );
}

process.stdout.write(`\n${pad("PROVIDER", 20)}${pad("SPORT", 14)}${pad("STATE", 11)}${num("EVENTS", 7)}${num("BOUTS", 8)}${num("EMPTY", 7)}  ${pad("LAST WRITE", 12)}NOTE\n`);
process.stdout.write(`${"─".repeat(96)}\n`);

for (const p of [...report.providers].sort((a, b) => RANK[a.state] - RANK[b.state])) {
  const age = p.daysSinceWrite === null ? "never" : p.daysSinceWrite === 0 ? "today" : `${p.daysSinceWrite}d ago`;
  process.stdout.write(
    `${pad(p.source, 20)}${pad(String(p.sport), 14)}${pad(p.state, 11)}${num(p.events, 7)}${num(p.bouts, 8)}${num(p.emptyCards, 7)}  ${pad(age, 12)}${p.note ?? ""}\n`,
  );
}
process.stdout.write(`${"─".repeat(96)}\n`);
process.stdout.write(`EMPTY = cards this source wrote that hold no bouts — its own quality signal.\n`);

// ── Graph completeness ────────────────────────────────────────────────────
const g = report.graph;
const pct = (a: number, b: number) => (b ? `${Math.round((a / b) * 100)}%` : "—");
process.stdout.write(`\nGRAPH COMPLETENESS\n${"─".repeat(96)}\n`);
process.stdout.write(`  bouts with a known ruleset   ${num(g.boutsWithRuleset, 7)} / ${g.bouts}  (${pct(g.boutsWithRuleset, g.bouts)})\n`);
process.stdout.write(`  fighters with disciplines    ${num(g.fightersCalculated, 7)} / ${g.fighters}  (${pct(g.fightersCalculated, g.fighters)})\n`);
process.stdout.write(`  multi-discipline fighters    ${num(g.multiDiscipline, 7)}\n`);

if (g.unknownByPromotion.length > 0) {
  process.stdout.write(`\n  UNKNOWN ruleset, by promotion — every gap with a name:\n`);
  for (const u of g.unknownByPromotion.slice(0, 12)) {
    process.stdout.write(`    ${pad(u.promotion || "(none)", 34)}${num(u.bouts, 7)} bouts\n`);
  }
}

const broken = report.providers.filter((p) => p.state === "silent" || p.state === "never-run");
process.stdout.write(`\n${broken.length === 0 ? "No silent providers." : `${broken.length} provider(s) silent or never run: ${broken.map((p) => p.source).join(", ")}`}\n`);

await prisma.$disconnect();
