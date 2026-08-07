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

  console.log(
    `\nCURRENT TITLEHOLDERS · ${report.totals.champions} · ${report.totals.withIssues} with issues` +
      // Stated next to the count it is deliberately NOT part of. A vacant belt
      // is a fact about a title, not a person, and folding it into
      // "titleholders" both inflates the number and prints "(vacant)" under a
      // Holder column.
      (report.totals.vacant ? ` · ${report.totals.vacant} vacant belt(s), held by nobody` : ""),
  );
  console.log("═".repeat(104));
  console.log(`  ${pad("Org", 10)} ${pad("Division", 26)} ${pad("Gender", 8)} ${pad("Holder", 32)} ${pad("Since", 11)} Provider`);
  console.log("─".repeat(104));

  if (rows.length === 0) {
    console.log(issuesOnly ? "\nEvery titleholder is backed by evidence.\n" : "\nNo titleholders on record.\n");
    return;
  }

  for (const c of rows) {
    const mark = c.issues.length === 0 ? "✓" : "✗";
    // The STATUS has to be on the line. Every open reign printed identically,
    // which was harmless while CHAMPION was the only status a connector could
    // produce and became actively misleading the moment interim titlists
    // arrived: Michał Cieślak (WBC cruiserweight INTERIM) rendered exactly like
    // Noel Mikaelian, who is the actual champion of that division. A reader of
    // this report would have come away with the wrong titleholder.
    const holder = c.status === "CHAMPION" ? (c.fighter ?? "—") : `${c.fighter ?? "(vacant)"} [${c.status}]`;
    console.log(
      `${mark} ${pad(c.organisation, 10)} ${pad(c.division, 26)} ${pad(c.gender, 8)} ` +
        `${pad(holder, 32)} ${pad(c.since ?? "—", 11)} ${c.provider ?? "—"}`,
    );
    if (c.issues.length) console.log(`  ${" ".repeat(10)} └─ ${c.issues.join(", ")}`);
    if (c.sourceUrl) console.log(`  ${" ".repeat(10)}    ${c.sourceUrl}`);
  }

  console.log("═".repeat(104));
  if (report.orgsWithoutRankings.length) {
    // A COVERAGE gap, reported once. These bodies' titles are recorded and
    // evidenced; their contender ratings are not ingested because we have no
    // cleared source for them. That is the next thing to go and get, not a
    // fault in the belts we already hold.
    console.log(
      `\nTitles recorded, contender ratings NOT ingested: ${report.orgsWithoutRankings.join(", ")}.\n` +
        `Those bodies publish no ratings we are cleared to read (BoxRec is blocklisted), so the\n` +
        `belts are sourced and the ladders behind them are not. A coverage gap, not a defect.`,
    );
  }
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
