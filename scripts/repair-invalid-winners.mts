// Repair bouts whose winnerId is not one of their own two corners.
//
//   npm run repair:invalid-winners             # DRY RUN
//   npm run repair:invalid-winners -- --apply
//
// The write path that produced these is fixed (persist.ts now resolves and
// asserts the winner against the FINAL corners), so this closes the rows that
// were already written and nothing can add more.
//
// ── WHY THE WINNER IS DROPPED, NOT REMAPPED ────────────────────────────────
//
// Every one of these is a near-duplicate the deduper missed: a stored red of
// "Soe Htet Oo" against a winner of "Soe Lin Oo", "Pentor SP Kansard" against
// "Pentor SP.Kansart", "Fritz Aldin Biagtan" against "Fritz Biagtan". Deciding
// those are the same person is exactly the guess that corrupts a result — and
// two of them plainly are NOT (Soe Htet Oo and Soe Lin Oo are different
// fighters, both with their own bouts).
//
// So the result is downgraded to SCHEDULED with the winner cleared, which is the
// same treatment requireAttributedWinner gives an unattributable win at ingest.
// The next results harvest re-reads the card and writes a winner that is on it.
// A dropped result is recoverable; a wrong one silently rewrites a record.
import { prisma } from "../src/lib/db.ts";

const APPLY = process.argv.includes("--apply");

async function main() {
  console.log(`\n  Invalid-winner repair — ${APPLY ? "APPLYING" : "DRY RUN (nothing written)"}\n`);

  const rows = await prisma.fight.findMany({
    where: { winnerId: { not: null } },
    select: {
      id: true, slug: true, winnerId: true, redId: true, blueId: true, result: true,
      picksResolvedAt: true,
      red: { select: { name: true } },
      blue: { select: { name: true } },
      _count: { select: { picks: true, battles: true } },
    },
  });

  const broken = rows.filter((f) => f.winnerId !== f.redId && f.winnerId !== f.blueId);
  console.log(`  ${rows.length} bouts with a winner · ${broken.length} in the IMPOSSIBLE state\n`);
  if (broken.length === 0) { console.log("  Nothing to repair.\n"); return; }

  let graded = 0;
  for (const f of broken) {
    const w = await prisma.fighter.findUnique({ where: { id: f.winnerId! }, select: { name: true } });
    const picks = f._count.picks + f._count.battles;
    if (f.picksResolvedAt) graded += 1;
    console.log(`  ${f.slug}`);
    console.log(`      red=${f.red.name} · blue=${f.blue.name} · winner=${w?.name ?? "<<no such fighter>>"}`);
    console.log(`      result=${f.result} picks/battles=${picks} graded=${f.picksResolvedAt ? "YES" : "no"}`);
  }

  console.log(`\n  ${graded} of these had already been GRADED — settlement consequences were fanned out`);
  console.log("  from a winner who is not on the bout. Those need re-grading after repair.");

  if (!APPLY) { console.log("\n  DRY RUN — nothing written. Re-run with --apply.\n"); return; }

  const ids = broken.map((f) => f.id);
  const res = await prisma.fight.updateMany({
    where: { id: { in: ids } },
    data: {
      winnerId: null,
      result: "SCHEDULED",
      method: null,
      roundEnded: null,
      // Clear the settlement claim so the next resolve pass re-grades from the
      // corrected result rather than skipping the bout as already done.
      picksResolvedAt: null,
    },
  });

  const left = await prisma.$queryRaw<{ n: bigint }[]>`
    SELECT COUNT(*)::bigint AS n FROM "Fight"
    WHERE "winnerId" IS NOT NULL
      AND "winnerId" <> "redId"
      AND "winnerId" <> "blueId"`;

  console.log(`\n  ${res.count} bout(s) reset to SCHEDULED with the winner cleared.`);
  console.log(`  Remaining impossible states: ${left[0].n}\n`);
}

try {
  await main();
} finally {
  await prisma.$disconnect();
}
