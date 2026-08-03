// Populate pound-for-pound for EVERY combat sport.
//
//   npm run p4p:generate            # dry — what each sport would get, and why
//   npm run p4p:generate -- --apply
//
// Same code path as the `refresh-p4p` cron: curated source-backed lists first,
// then the rating engine for the sports curated does not cover. The engine never
// clobbers a source-backed list — it is only ever consulted for a sport that has
// none, which is exactly how the public read resolves them too.
//
// Fighter selection is `rankableInDiscipline` (verified BOUT evidence, not the
// imported sport label) plus a minimum bout count, so a sport with no real bouts
// produces NOTHING rather than a list of stubs. A sport reported as `skipped: no
// fighters` is telling you it has no evidence, not that the job failed.
import { ingestCuratedP4P } from "../src/lib/rankings/curated/ingest.ts";
import { generateAllP4P } from "../src/lib/rankings/generate.ts";
import { SPORTS } from "../src/lib/sports.ts";
import { prisma } from "../src/lib/db.ts";

const apply = process.argv.includes("--apply");
const pad = (s: string | number, w: number) => String(s).padEnd(w);
const num = (s: string | number, w: number) => String(s).padStart(w);

process.stdout.write(`\nPOUND-FOR-POUND — ${apply ? "APPLYING" : "DRY RUN"}\n${"═".repeat(78)}\n`);

// Where each sport stands BEFORE anything runs, so the effect is legible.
const before = await prisma.$queryRaw<{ sport: string; sourced: bigint; generated: bigint }[]>`
  SELECT w.sport::text AS sport,
         COUNT(*) FILTER (WHERE r.source <> 'generated') AS sourced,
         COUNT(*) FILTER (WHERE r.source =  'generated') AS generated
  FROM "Ranking" r JOIN "WeightClass" w ON w.id = r."weightClassId"
  WHERE r."isPoundForPound" GROUP BY 1
`;
const B = new Map(before.map((r) => [r.sport, r]));

process.stdout.write(`${pad("SPORT", 16)}${num("SOURCED", 9)}${num("ENGINE", 8)}   WHAT WILL SERVE\n`);
process.stdout.write(`${"─".repeat(78)}\n`);
for (const s of SPORTS) {
  const b = B.get(s.value);
  const sourced = Number(b?.sourced ?? 0n), gen = Number(b?.generated ?? 0n);
  const serving = sourced > 0 ? "source-backed list" : gen > 0 ? "rating engine (no source exists)" : "nothing yet";
  process.stdout.write(`${pad(s.value, 16)}${num(sourced, 9)}${num(gen, 8)}   ${serving}\n`);
}

if (!apply) {
  process.stdout.write(`\nDry run — nothing written. Re-run with --apply.\n`);
  await prisma.$disconnect();
  process.exit(0);
}

process.stdout.write(`\nCURATED (source-backed)\n${"─".repeat(78)}\n`);
for (const r of await ingestCuratedP4P()) {
  process.stdout.write(`  ${pad(r.sport, 16)}${num(r.ranked, 5)} ranked${r.skipped ? `   skipped: ${r.skipped}` : ""}\n`);
}

process.stdout.write(`\nRATING ENGINE (only sports with no source-backed list)\n${"─".repeat(78)}\n`);
for (const r of await generateAllP4P(SPORTS.map((s) => s.value))) {
  process.stdout.write(
    `  ${pad(r.sport, 16)}${num(r.ranked, 5)} ranked  ${num(r.unranked, 5)} below the bout threshold` +
    `${r.skipped ? `   skipped: ${r.skipped}` : ""}\n`,
  );
}

const after = await prisma.$queryRaw<{ sport: string; n: bigint }[]>`
  SELECT w.sport::text AS sport, COUNT(*) AS n
  FROM "Ranking" r JOIN "WeightClass" w ON w.id = r."weightClassId"
  WHERE r."isPoundForPound" GROUP BY 1 ORDER BY 1
`;
process.stdout.write(`\nRESULT\n${"─".repeat(78)}\n`);
const covered = new Set(after.map((r) => r.sport));
for (const s of SPORTS) {
  const n = Number(after.find((r) => r.sport === s.value)?.n ?? 0n);
  process.stdout.write(`  ${n > 0 ? "OK  " : "NONE"}  ${pad(s.value, 16)}${num(n, 5)} ranked\n`);
}
const missing = SPORTS.filter((s) => !covered.has(s.value)).map((s) => s.value);
process.stdout.write(
  `\n${covered.size}/${SPORTS.length} sports have a pound-for-pound list.` +
  `${missing.length ? `\nNo evidence to rank: ${missing.join(", ")} — these need bouts, not a ranking job.\n` : "\n"}`,
);

await prisma.$disconnect();
