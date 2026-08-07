/**
 * One-off repair: fighters stored in the casing their source shouted.
 *
 * Sanctioning bodies publish ratings tables in caps. Every fighter the ranking
 * ingest created from one was stored verbatim, so the boxing board reads
 * "MURAT GASSIEV" next to "Dmitry Bivol" — the difference being only that Bivol
 * already existed under a properly-cased name.
 *
 * The write path is fixed (lib/registry/identity createProvisional now calls
 * displayName). This repairs the rows written before it was.
 *
 * SAFE BY CONSTRUCTION: only rows with NO lower-case letter are touched, and
 * the rewrite never changes nameKey(), so no identity, alias, slug or external
 * id relationship moves. A name someone deliberately styled is left alone.
 *
 * Idempotent — safe to run repeatedly.
 *
 *   npm run repair:shouted-names          # dry run
 *   npm run repair:shouted-names -- --apply
 */
import { PrismaClient } from "@prisma/client";
import { displayName, nameKey } from "../src/services/normalization/names.ts";

const prisma = new PrismaClient();
const apply = process.argv.includes("--apply");

async function main() {
  const fighters = await prisma.fighter.findMany({ select: { id: true, name: true, sport: true } });

  // A name with any lower-case letter was cased by somebody. Leave it.
  const shouted = fighters.filter((f) => f.name.trim() && !/[a-z]/.test(f.name));
  console.log(`${fighters.length} fighters, ${shouted.length} stored all-caps\n`);

  let changed = 0;
  let skipped = 0;
  for (const f of shouted) {
    const next = displayName(f.name);
    if (next === f.name) continue;

    // Paranoia, but cheap: the repair must be invisible to identity matching.
    // If a rewrite ever moved the key it would silently orphan aliases and
    // external ids, and that is not something to discover later.
    if (nameKey(next) !== nameKey(f.name)) {
      console.log(`SKIP ${f.name} → ${next}  (identity key would move)`);
      skipped++;
      continue;
    }

    changed++;
    if (changed <= 25) console.log(`${apply ? "FIX " : "WOULD FIX "}[${f.sport}] ${f.name} → ${next}`);
    if (apply) await prisma.fighter.update({ where: { id: f.id }, data: { name: next } });
  }
  if (changed > 25) console.log(`… and ${changed - 25} more`);

  console.log(`\n${apply ? "Updated" : "Would update"} ${changed} fighter(s). ${skipped} skipped.`);
  if (!apply && changed) console.log("Dry run — re-run with --apply to write.");
}

main()
  .catch((e) => { console.error(e); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
