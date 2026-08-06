// Every current titleholder, and the evidence behind them.
//
//   npm run audit:champions
//   npm run audit:champions -- --issues
//
// Boxing has no single champion per division and the report does not pretend
// otherwise: a heavyweight can hold the WBA belt while someone else holds the
// WBC one. Rows are therefore grouped by ORGANISATION, never merged into a
// "Boxing Heavyweight Champion" that frequently does not exist.

import { prisma } from "@/lib/db";
import { auditChampionAccuracy } from "@/lib/admin/ranking-accuracy";

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
  const report = await auditChampionAccuracy();
  const rows = issuesOnly ? report.champions.filter((c) => c.issues.length) : report.champions;

  console.log(`\nCURRENT TITLEHOLDERS · ${report.totals.champions} · ${report.totals.withIssues} with issues`);
  console.log("═".repeat(104));
  console.log(`  ${pad("Org", 10)} ${pad("Division", 26)} ${pad("Gender", 8)} ${pad("Holder", 24)} ${pad("Since", 11)} Provider`);
  console.log("─".repeat(104));

  if (rows.length === 0) {
    console.log(issuesOnly ? "\nEvery titleholder is backed by evidence.\n" : "\nNo titleholders on record.\n");
    return;
  }

  for (const c of rows) {
    const mark = c.issues.length === 0 ? "✓" : "✗";
    console.log(
      `${mark} ${pad(c.organisation, 10)} ${pad(c.division, 26)} ${pad(c.gender, 8)} ` +
        `${pad(c.fighter ?? "(vacant)", 24)} ${pad(c.since ?? "—", 11)} ${c.provider ?? "—"}`,
    );
    if (c.issues.length) console.log(`  ${" ".repeat(10)} └─ ${c.issues.join(", ")}`);
    if (c.sourceUrl) console.log(`  ${" ".repeat(10)}    ${c.sourceUrl}`);
  }

  console.log("═".repeat(104));
  if (report.legacyOnly > 0) {
    // Expected until the champion projection has run. Stated as a migration
    // state rather than flagged as breakage, because reporting every belt as
    // broken on the day the new pipeline lands would be crying wolf.
    console.log(
      `\n${report.legacyOnly} titleholder(s) exist only in the legacy Champion table, with no TitleReign\n` +
        `behind them. That is the expected state until /api/cron/refresh-champions has run\n` +
        `with the projection — after that, any remaining ones are a real gap.`,
    );
  }
  console.log();
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
