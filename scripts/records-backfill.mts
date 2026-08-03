// Derive every fighter's win/loss record from the bouts we hold.
//
//   npm run backfill:records                    # DRY RUN
//   npm run backfill:records -- --apply
//   npm run backfill:records -- --apply --force # also recompute published records
//
// Why this exists, and why it is not optional: every provider that writes bouts
// leaves the two fighters' record columns untouched. Measured 2026-08-03, 13
// fighters out of 10,419 had a record while the database held 13,603 decided
// bouts. Every profile therefore rendered a blank record, and the rating engine
// — which reads those columns — could not rank a single fighter in any sport.
//
// See src/lib/fighters/derive-records.ts for the counting rules. The important
// one: win/loss comes from `winnerId`, never from `result`, because `result` is
// stored from the RED corner's point of view on some import paths and trusting
// it hands every blue-corner winner a loss.
import { applyDerivedRecords } from "../src/lib/fighters/derive-records.ts";
import { prisma } from "../src/lib/db.ts";

const apply = process.argv.includes("--apply");
const force = process.argv.includes("--force");
const fill = process.argv.includes("--fill");

const pad = (s: string | number, w: number) => String(s).padEnd(w);
const num = (s: string | number, w: number) => String(s).padStart(w);

const before = await prisma.$queryRaw<{ sport: string; total: bigint; withRecord: bigint }[]>`
  SELECT sport::text AS sport, COUNT(*) AS total,
         COUNT(*) FILTER (WHERE wins + losses + draws > 0) AS "withRecord"
  FROM "Fighter" GROUP BY 1 ORDER BY 1
`;

process.stdout.write(`\nFIGHTER RECORDS — ${apply ? "APPLYING" : "DRY RUN (nothing written)"}\n`);
if (force) {
  process.stdout.write(
    `--force: provider-published records will ALSO be recomputed. Ours counts only the\n` +
    `bouts we hold, so this can REPLACE a fuller career record with a partial one.\n`,
  );
}
process.stdout.write(`${"═".repeat(64)}\n`);

const summary = await applyDerivedRecords({ apply, mode: force ? "force" : fill ? "fill" : "grow" });

const after = await prisma.$queryRaw<{ sport: string; total: bigint; withRecord: bigint }[]>`
  SELECT sport::text AS sport, COUNT(*) AS total,
         COUNT(*) FILTER (WHERE wins + losses + draws > 0) AS "withRecord"
  FROM "Fighter" GROUP BY 1 ORDER BY 1
`;
const A = new Map(after.map((r) => [r.sport, r]));

process.stdout.write(`${pad("SPORT", 16)}${num("FIGHTERS", 10)}${num("BEFORE", 9)}${num("AFTER", 8)}\n`);
process.stdout.write(`${"─".repeat(64)}\n`);
for (const b of before) {
  const a = A.get(b.sport);
  process.stdout.write(
    `${pad(b.sport, 16)}${num(Number(b.total), 10)}${num(Number(b.withRecord), 9)}${num(Number(a?.withRecord ?? 0n), 8)}\n`,
  );
}
process.stdout.write(`${"─".repeat(64)}\n`);
process.stdout.write(
  `  scanned   ${summary.scanned} fighters with at least one decided bout\n` +
  `  updated   ${summary.updated}\n` +
  `  unchanged ${summary.unchanged}\n` +
  `  preserved ${summary.preserved}  (a provider had already published a record)\n`,
);

if (!apply) process.stdout.write(`\nDry run — re-run with --apply to write.\n`);
else process.stdout.write(`\nDone. Re-run \`npm run p4p:generate -- --apply\` so the rating engine sees them.\n`);

await prisma.$disconnect();
