// Run the ranking connectors once, by hand.
//
//   npm run rankings:ingest            # what WOULD run, and why — no writes
//   npm run rankings:ingest -- --apply # actually ingest
//
// The same code path the weekly `gf-cron-rankings` job takes, so a result here
// is a real answer about production and not an approximation of one.
//
// ── IT DID NOT USED TO BE ───────────────────────────────────────────────────
// This script looped `ingestConnector` and stopped, while the cron calls
// `ingestAllRankings`, whose whole second half is the PROJECTION — reconciling
// every provider's observations into the published `Ranking` board and into
// `TitleReign`. So a `--apply` run wrote observations, printed "All connectors
// succeeded", and left the public rankings and champions pages exactly as they
// were. The one tool an operator reaches for to answer "is the pipeline
// working?" was structurally incapable of finishing the job it reported on.
//
// The projection now runs here too, and its numbers are printed, because
// `imported=276` with `published=0` is the interesting failure and the old
// output could not express it.
//
// Dry run is the DEFAULT. A ranking ingest creates fighters, rewrites divisions
// and can retire a champion, so "I just wanted to see if it works" must not be
// spelled the same way as "publish this".
import { RANKING_SOURCES, ingestibleSources } from "../src/lib/rankings/sources.ts";
import { ingestConnector } from "../src/lib/rankings/ingest.ts";
import { projectRankings } from "../src/lib/rankings/pipeline.ts";
import { projectChampions } from "../src/lib/rankings/champions.ts";
import { allConnectors, INGEST_BLOCKLIST } from "../src/lib/rankings/connectors/index.ts";
import { readFlags } from "../src/lib/feature-flags.ts";
import { prisma } from "../src/lib/db.ts";

const apply = process.argv.includes("--apply");
const flags = readFlags();

process.stdout.write(`\nRANKING CONNECTORS\n${"─".repeat(72)}\n`);
process.stdout.write(`RANKINGS_INGEST_ENABLED = ${flags.rankingsIngestEnabled}\n`);
process.stdout.write(`RANKINGS_ENABLED        = ${flags.rankingsEnabled}  (serving, not ingesting)\n\n`);

const ready = new Set(allConnectors().map((c) => c.id));
for (const s of RANKING_SOURCES) {
  // Say WHY a source is not running. "not ingestible" without a reason is how a
  // licensing decision and a missing parser get confused for each other.
  const reasons: string[] = [];
  if (INGEST_BLOCKLIST.has(s.id)) reasons.push("BLOCKLISTED");
  if (!s.licensed) reasons.push("not licensed");
  if (!s.connectorReady) reasons.push("no parser");
  else if (!ready.has(s.id)) reasons.push("parser not registered");
  const state = reasons.length === 0 ? "WILL RUN" : reasons.join(" + ");
  process.stdout.write(`  ${state === "WILL RUN" ? "▶" : "·"} ${s.id.padEnd(16)} ${state}\n`);
}

const connectors = ingestibleSources()
  .map((s) => allConnectors().find((c) => c.id === s.id))
  .filter((c): c is NonNullable<typeof c> => Boolean(c));

process.stdout.write(`\n${connectors.length} connector(s) would run.\n`);

if (!apply) {
  process.stdout.write(`\nDry run — nothing was fetched or written. Re-run with --apply.\n`);
  await prisma.$disconnect();
  process.exit(0);
}

if (!flags.rankingsIngestEnabled) {
  // ingestAllRankings() would return [] here anyway; saying so beats a silent
  // empty run that looks like "the sources had nothing".
  process.stdout.write(`\nRefusing: RANKINGS_INGEST_ENABLED is not "true", so the cron path is a no-op.\n`);
  await prisma.$disconnect();
  process.exit(1);
}

process.stdout.write(`\nINGESTING\n${"─".repeat(72)}\n`);
let failed = 0;
for (const c of connectors) {
  try {
    const stat = await ingestConnector(c);
    if (!stat.ok) failed += 1;
    process.stdout.write(
      `  ${stat.ok ? "ok  " : "FAIL"} ${stat.source.padEnd(16)} fetched=${stat.fetched} imported=${stat.imported} ` +
      `champions=${stat.championsImported} newFighters=${stat.fightersCreated} skipped=${stat.skippedByPrecedence}` +
      `${stat.error ? `  — ${stat.error}` : ""}\n`,
    );
  } catch (e) {
    failed += 1;
    process.stdout.write(`  FAIL ${c.id.padEnd(16)} ${(e as Error).message}\n`);
  }
}

process.stdout.write(`\n${failed === 0 ? "All connectors succeeded." : `${failed} connector(s) failed.`}\n`);

// ── PROJECT ─────────────────────────────────────────────────────────────────
// Once, after every connector — never inside the loop. Reconciliation decides a
// division by looking at ALL providers' evidence at the same time; projecting
// per connector would decide each list against whichever sources happened to
// have run already. Mirrors ingestAllRankings().
process.stdout.write(`\nPROJECTING\n${"─".repeat(72)}\n`);
const [ranked, champions] = await Promise.all([projectRankings(), projectChampions()]);
process.stdout.write(
  `  rankings   lists=${ranked.lists} written=${ranked.rowsWritten} removed=${ranked.rowsRemoved} contested=${ranked.contested}\n` +
  `  champions  titles=${champions.titles} opened=${champions.reignsOpened} closed=${champions.reignsClosed} contested=${champions.contested}\n`,
);

await prisma.$disconnect();
process.exit(failed === 0 ? 0 : 1);
