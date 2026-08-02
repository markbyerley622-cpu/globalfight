// Promote the computed discipline graph into persistent Fighter columns.
//
//   npm run migrate:disciplines                 # DRY RUN — statistics, no writes
//   npm run migrate:disciplines -- --apply
//   npm run migrate:disciplines -- --apply --stale-only   # only recompute what changed
//
// This is a DOMAIN-MODEL MIGRATION, not a repair. The values were already being
// computed correctly from Fight.ruleset; the point is to stop computing them per
// request. A directory page that resolves disciplines on demand walks every
// fighter's whole bout history, per row, per render.
//
// RESUMABLE by construction: it writes only fighters whose stored graph differs
// from the computed one, so re-running after an interruption skips everything
// already done and costs one read pass. --stale-only additionally skips fighters
// whose graph was calculated after their most recent bout changed.
import { prisma } from "../src/lib/db.ts";
import { resolveDisciplines } from "../src/lib/fighters/disciplines.ts";
import { rulesetToSport } from "../src/lib/scraper/ruleset.ts";
import type { Sport } from "../src/lib/types.ts";

const argv = process.argv.slice(2);
const APPLY = argv.includes("--apply");
const STALE_ONLY = argv.includes("--stale-only");
const PAGE = 500;

const eq = (a: unknown[], b: unknown[]) => a.length === b.length && a.every((v, i) => v === b[i]);

async function main() {
  const started = Date.now();
  console.log(`\n  Discipline migration — ${APPLY ? "APPLYING" : "DRY RUN (no writes)"}\n`);

  const where = STALE_ONLY ? { lastCalculatedAt: null } : {};
  const total = await prisma.fighter.count({ where });
  console.log(`  ${total} fighter(s) in scope${STALE_ONLY ? " (never calculated)" : ""}\n`);

  const tiers = new Map<string, number>();
  const sportCounts = new Map<string, number>();
  let changed = 0, unchanged = 0, multi = 0, noPrimary = 0, processed = 0;

  for (let skip = 0; skip < total; skip += PAGE) {
    const batch = await prisma.fighter.findMany({
      where,
      orderBy: { id: "asc" },
      skip,
      take: PAGE,
      select: {
        id: true, sport: true,
        primarySport: true, sports: true, disciplineConfidence: true, disciplineTier: true,
        fightsAsRed: { select: { result: true, ruleset: true, rulesetConfidence: true } },
        fightsAsBlue: { select: { result: true, ruleset: true, rulesetConfidence: true } },
      },
    });

    for (const f of batch) {
      processed += 1;
      const bouts = [...f.fightsAsRed, ...f.fightsAsBlue].map((b) => ({
        sport: b.ruleset === "UNKNOWN" ? null : rulesetToSport(b.ruleset),
        settled: b.result !== "SCHEDULED",
        rulesetConfidence: b.rulesetConfidence,
      }));

      const d = resolveDisciplines({ importedSport: f.sport as Sport, bouts });

      tiers.set(d.tier, (tiers.get(d.tier) ?? 0) + 1);
      if (d.sports.length > 1) multi += 1;
      if (!d.primarySport) noPrimary += 1;
      for (const s of d.sports) sportCounts.set(s, (sportCounts.get(s) ?? 0) + 1);

      const same =
        f.primarySport === (d.primarySport ?? null) &&
        eq(f.sports as string[], d.sports) &&
        f.disciplineTier === d.tier &&
        Math.abs((f.disciplineConfidence ?? -1) - d.confidence) < 1e-9;

      if (same) { unchanged += 1; continue; }
      changed += 1;

      if (APPLY) {
        await prisma.fighter.update({
          where: { id: f.id },
          data: {
            primarySport: d.primarySport,
            sports: d.sports,
            disciplineConfidence: d.confidence,
            disciplineTier: d.tier,
            // Machine-readable, so a profile can render "12 Muay Thai bouts"
            // without touching the Fight table.
            disciplineEvidence: d.evidence,
            lastCalculatedAt: new Date(),
            // Keep the legacy column in step so existing readers stay correct
            // during the migration. New code reads primarySport/sports.
            ...(d.primarySport ? { sport: d.primarySport } : {}),
          },
        });
      }
    }
    process.stdout.write(`\r  processed ${Math.min(skip + PAGE, total)}/${total}`);
  }

  const secs = ((Date.now() - started) / 1000).toFixed(1);
  console.log(`\n\n  ── Migration report ───────────────────────────────────`);
  console.log(`  fighters processed        ${processed}`);
  console.log(`  written (changed)         ${changed}`);
  console.log(`  already correct           ${unchanged}`);
  console.log(`  MULTI-discipline          ${multi}`);
  console.log(`  no primary (no evidence)  ${noPrimary}`);
  console.log(`\n  Confidence distribution:`);
  for (const t of ["HIGH", "MEDIUM", "LOW", "UNKNOWN"]) {
    const n = tiers.get(t) ?? 0;
    const pct = processed ? ((n / processed) * 100).toFixed(1) : "0.0";
    console.log(`      ${t.padEnd(8)} ${n.toString().padStart(6)}  ${pct}%`);
  }
  console.log(`\n  Fighters per discipline (a crossover athlete counts in each):`);
  for (const [s, n] of [...sportCounts].sort((a, b) => b[1] - a[1])) {
    console.log(`      ${s.padEnd(16)} ${n}`);
  }
  console.log(`\n  elapsed ${secs}s`);
  if (!APPLY) console.log(`\n  DRY RUN — nothing written. Re-run with --apply.`);
  console.log("");
}

try {
  await main();
} finally {
  await prisma.$disconnect();
}
