// Per-promotion data coverage — the "where is the pipeline drifting?" report.
//
//   npm run audit:quality
//   npm run audit:quality -- --gaps     # only the rows that need work
//
// Point it at production by exporting DATABASE_URL first. The banner says which
// database it read, because answering this question about the wrong one is the
// fastest way to a confident wrong answer.

import { prisma } from "@/lib/db";
import { auditDataQuality, type CoverageStatus } from "@/lib/admin/data-quality";

const gapsOnly = process.argv.includes("--gaps");

const ICON: Record<CoverageStatus, string> = {
  healthy: "✓",
  warning: "!",
  critical: "✗",
  empty: "·",
};

function redactedDbTarget(): string {
  const raw = process.env.DATABASE_URL;
  if (!raw) return "(DATABASE_URL unset)";
  try {
    const u = new URL(raw);
    return `${u.hostname}/${u.pathname.replace(/^\//, "")}`;
  } catch {
    return "(unparseable DATABASE_URL)";
  }
}

const pad = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s.padEnd(n));
const num = (n: number, w: number) => String(n).padStart(w);

async function main() {
  console.log(`\nDatabase: ${redactedDbTarget()}`);

  const report = await auditDataQuality();
  const rows = gapsOnly ? report.promotions.filter((p) => p.status !== "healthy") : report.promotions;

  console.log(`\nDATA QUALITY · ${report.promotions.length} promotions · ${report.totals.events} events`);
  console.log("═".repeat(92));
  console.log(
    `  ${pad("Promotion", 26)} ${num(0, 6).replace("0", "Events".padStart(6))} ${"NoBouts".padStart(8)} ${"NoResult".padStart(9)} ${"Champs".padStart(7)} ${"Ranks".padStart(6)}  Status`,
  );
  console.log("─".repeat(92));

  for (const p of rows) {
    console.log(
      `${ICON[p.status]} ${pad(p.promotion, 26)} ${num(p.events, 6)} ${num(p.missingBouts, 8)} ${num(p.missingResults, 9)} ` +
        `${(p.hasChampions ? "yes" : "—").padStart(7)} ${(p.hasRankings ? "yes" : "—").padStart(6)}  ${p.status}`,
    );
    if (p.status !== "healthy") console.log(`  ${" ".repeat(26)} └─ ${p.note}`);
  }

  console.log("═".repeat(92));
  console.log(
    `TOTALS  ${report.totals.missingBouts} events with no bouts · ` +
      `${report.totals.missingResults} finished cards with no result · ` +
      `${report.totals.promotionsWithGaps} promotion(s) need work`,
  );

  if (gapsOnly && rows.length === 0) console.log("\nEvery promotion is complete.\n");
  else console.log();

  // A non-zero exit when something is CRITICAL, so this can gate a deploy or a
  // scheduled check without anyone having to parse the table.
  if (report.promotions.some((p) => p.status === "critical")) process.exitCode = 1;
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
