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
  console.log("═".repeat(100));
  console.log(
    `  ${pad("Promotion", 24)} ${"Events".padStart(6)} ${"NoBouts".padStart(8)} ${"NoResult".padStart(9)} ` +
      `${"Reach".padStart(6)} ${"Upcom".padStart(6)} ${"Champs".padStart(7)} ${"Ranks".padStart(6)}  Status`,
  );
  console.log("─".repeat(100));

  for (const p of rows) {
    console.log(
      `${ICON[p.status]} ${pad(p.promotion, 24)} ${num(p.events, 6)} ${num(p.missingBouts, 8)} ${num(p.missingResults, 9)} ` +
        `${num(p.reachableByBackfill, 6)} ${num(p.upcomingMissingCard, 6)} ` +
        `${(p.hasChampions ? "yes" : "—").padStart(7)} ${(p.hasRankings ? "yes" : "—").padStart(6)}  ${p.status}`,
    );
    if (p.status !== "healthy") console.log(`  ${" ".repeat(24)} └─ ${p.note}`);
  }

  console.log("═".repeat(100));
  console.log(
    `TOTALS  ${report.totals.missingBouts} events with no bouts · ` +
      `${report.totals.missingResults} finished cards with no result · ` +
      `${report.totals.promotionsWithGaps} promotion(s) need work`,
  );

  // ── The column that decides the next sprint ─────────────────────────────
  // "Reach" is how many gap events the EXISTING Wikipedia backfill would already
  // queue. A large number here means the gaps are a BACKLOG, not a missing
  // source — and building new connectors before draining it would be writing a
  // second solution to a problem whose first solution is already merged.
  const reach = report.totals.reachableByBackfill;
  if (reach > 0) {
    // Deliberately NOT expressed as a percentage of the gap columns. "Reach"
    // counts events with ANY undecided bout, while NoResult counts events where
    // NOTHING is decided — so Reach legitimately exceeds the gap total (a
    // half-resolved card is reachable but is not a gap by that definition). An
    // earlier draft printed the ratio and reported 172%, which is exactly the
    // kind of number that makes a reader stop trusting the whole report.
    console.log(
      `\n${reach} events are ALREADY queue-eligible for the existing Wikipedia backfill\n` +
        `(/api/cron/refresh-wikicards) — every event with no card, plus every one with a\n` +
        `bout still undecided. Confirm that job is running before building new connectors.\n` +
        `See docs/CRON.md.`,
    );
  }

  const h = report.health;
  console.log("\nPIPELINE HEALTH");
  console.log("─".repeat(100));
  console.log(`  stale rankings (>14d unreconciled) : ${h.staleRankings}`);
  console.log(`  champions last updated             : ${h.championsUpdatedAt?.slice(0, 16).replace("T", " ") ?? "never"}`);
  console.log(`  identity questions awaiting review : ${h.duplicateCandidates}`);
  if (h.providers.length) {
    console.log("\n  provider                     last checked      last changed      fails  cursor");
    for (const p of h.providers) {
      // "never changed" is the interesting state and is easy to miss beside a
      // recent "last checked" — a provider polled hourly that has not moved in
      // weeks is either genuinely quiet or genuinely broken, and only the two
      // dates side by side can tell you which.
      const cursor = p.cursor === null ? "—" : p.exhausted ? `${p.cursor} (caught up)` : `page ${p.cursor}`;
      console.log(
        `  ${pad(p.provider, 28)} ${(p.lastCheckedAt?.slice(0, 16).replace("T", " ") ?? "never").padEnd(17)} ` +
          `${(p.lastChangedAt?.slice(0, 16).replace("T", " ") ?? "never").padEnd(17)} ${num(p.failureStreak, 5)}  ${cursor}`,
      );
      if (p.lastError) console.log(`  ${" ".repeat(28)} └─ ${p.lastError.slice(0, 60)}`);
    }
  } else {
    // Be precise about what an empty table means. It is NOT "the checkpoint
    // system is broken" — checkpoints are written by exactly two paths (the ONE
    // archive crawl and the ranking connectors), so an empty table means neither
    // has run against THIS database. Reading it as a bug sent a previous
    // investigation looking for a writer that was working fine.
    console.log("  providers                          : no checkpoints — neither the ranking connectors nor the ONE");
    console.log("                                       archive crawl has run against this database yet.");
  }

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
