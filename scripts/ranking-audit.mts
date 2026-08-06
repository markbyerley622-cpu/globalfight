// Is every PUBLISHED ranking correct, and can it prove it?
//
//   npm run audit:rankings
//   npm run audit:rankings -- --issues    # only the lists with problems
//
// Companion to audit:quality, which measures how MUCH data there is. This one
// measures whether what we publish can explain itself.

import { prisma } from "@/lib/db";
import { auditRankingAccuracy } from "@/lib/admin/ranking-accuracy";

const issuesOnly = process.argv.includes("--issues");

const pad = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s.padEnd(n));

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

async function main() {
  console.log(`\nDatabase: ${redactedDbTarget()}`);
  const report = await auditRankingAccuracy();

  // ── Coverage first ──────────────────────────────────────────────────────
  // Printed before the per-list detail because it reframes everything below it.
  // "Every boxing champion is a woman" is answered here, in one line, without
  // anyone reading the connector registry.
  console.log("\nCOVERAGE BY SPORT");
  console.log("═".repeat(96));
  for (const c of report.coverage) {
    console.log(`  ${pad(c.sport, 14)} ${c.organisations.join(", ") || "(none)"}`);
    console.log(`  ${" ".repeat(14)} ${c.note}`);
  }

  const rows = issuesOnly ? report.lists.filter((l) => l.issues.length) : report.lists;

  console.log(`\nPUBLISHED LISTS · ${report.totals.lists} lists · ${report.totals.rows} rows · ${report.totals.withIssues} with issues`);
  console.log("═".repeat(96));

  if (rows.length === 0) {
    console.log(issuesOnly ? "Every published list is backed by evidence and current.\n" : "No rankings published.\n");
    return;
  }

  for (const l of rows) {
    const mark = l.issues.length === 0 ? "✓" : "✗";
    console.log(
      `${mark} ${pad(l.organisation, 12)} ${pad(l.division + (l.isPoundForPound ? " (P4P)" : ""), 28)} ` +
        `${pad(l.gender, 8)} ${String(l.rows).padStart(3)} rows`,
    );
    // Every field the brief asked to see for a published number.
    console.log(
      `    provider=${l.provider ?? "—"} tier=${l.tier ?? "—"} effective=${l.effectiveDate ?? "—"} ` +
        `confidence=${l.confidence ?? "—"} agreement=${l.agreementCount}${l.contested ? " CONTESTED" : ""}`,
    );
    console.log(`    reconciled=${l.reconciledAt ?? "never"}  source=${l.sourceUrl ?? "—"}`);
    if (l.issues.length) console.log(`    ✗ ${l.issues.join(", ")}`);
    console.log();
  }

  // Non-zero when something published cannot explain itself — so this can gate a
  // deploy without anyone reading the table.
  if (report.lists.some((l) => l.issues.includes("no_evidence") || l.issues.includes("mixed_gender"))) {
    process.exitCode = 1;
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
