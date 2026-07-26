// Settlement doctor — answers "why is this prediction still open?" with data.
//
//   node --env-file=.env --import tsx scripts/settlement-doctor.mts            # whole-DB report
//   node --env-file=.env --import tsx scripts/settlement-doctor.mts "fury"     # one bout
//   node --env-file=.env --import tsx scripts/settlement-doctor.mts --repair    # reconcile drift
//
// There are exactly TWO reasons a prediction can be unsettled, and they need
// opposite responses — which is precisely what "Open" hid:
//
//   AWAITING_RESULT     — no source has published an outcome for this bout. The
//                         settlement engine is idle because there is nothing to
//                         settle. Fix the RESULTS feed (or enter it in the admin
//                         editor); settlement then fires on the write.
//
//   AWAITING_SETTLEMENT — a result EXISTS and the picks are ungraded. This is the
//                         invariant being violated. `--repair` fixes it, and the
//                         fact that a repair was needed is itself the bug report.
//
// Read-only unless --repair is passed. It NEVER invents a result: writing an
// outcome nobody published is the one thing this must not do.
import { prisma } from "../src/lib/db.ts";
import { resolveDuePicks } from "../src/lib/intelligence/resolve.ts";
import { resultOps } from "../src/lib/intelligence/result-ops.ts";
import { pickStatus, STATUS_PRESENTATION } from "../src/lib/intelligence/pick-status.ts";

const args = process.argv.slice(2);
const repair = args.includes("--repair");
const query = args.find((a) => !a.startsWith("--"));

// ── Whole-DB invariant report ───────────────────────────────────────────────
const ops = await resultOps();
console.log("── settlement health ────────────────────────────────────────");
console.log(`  unsettledPicks    ${ops.unsettledPicks}   (decisive result, ungraded pick — MUST be 0)`);
console.log(`  unsettledBattles  ${ops.unsettledBattles}   (open battle on a decided bout — MUST be 0)`);
console.log(`  resolutionLag     ${ops.resolutionLag}   (decided fights never stamped settled)`);
console.log(`  awaitingResults   ${ops.awaitingResults}   (bouts over with NO result — a feed gap, not settlement)`);

if (ops.awaitingResults > 0) {
  console.log("\n  bouts over with no ingested result (newest first):");
  for (const s of ops.awaitingSample.slice(0, 10)) {
    console.log(`    ${s.date.slice(0, 10)}  ${s.event} — ${s.slug}`);
  }
}

// ── One bout, in detail ─────────────────────────────────────────────────────
if (query) {
  const fights = await prisma.fight.findMany({
    where: {
      OR: [
        { slug: { contains: query, mode: "insensitive" } },
        { red: { name: { contains: query, mode: "insensitive" } } },
        { blue: { name: { contains: query, mode: "insensitive" } } },
      ],
    },
    orderBy: { date: "desc" },
    take: 5,
    select: {
      id: true, slug: true, date: true, result: true, winnerId: true, method: true,
      roundEnded: true, timeEnded: true, cancelled: true, picksResolvedAt: true,
      red: { select: { id: true, name: true } },
      blue: { select: { id: true, name: true } },
      event: { select: { name: true, slug: true, date: true, status: true } },
      picks: { select: { userId: true, corner: true, correct: true } },
      battles: { select: { id: true, state: true, winnerId: true } },
    },
  });

  if (!fights.length) console.log(`\nno bout matches "${query}".`);

  for (const f of fights) {
    console.log(`\n── ${f.red.name} vs ${f.blue.name} ─────────────────────────`);
    console.log(`  bout        ${f.slug}`);
    console.log(`  event       ${f.event?.name ?? "—"} (${f.event?.status ?? "—"}) ${f.event?.date.toISOString().slice(0, 10) ?? ""}`);
    console.log(`  date        ${f.date.toISOString()}`);
    console.log(`  RESULT      ${f.result}${f.winnerId ? ` winner=${f.winnerId}` : ""}${f.method ? ` ${f.method}` : ""}${f.roundEnded ? ` R${f.roundEnded}` : ""}${f.timeEnded ? ` ${f.timeEnded}` : ""}`);
    console.log(`  settledAt   ${f.picksResolvedAt?.toISOString() ?? "— never"}`);
    console.log(`  picks       ${f.picks.length}   battles ${f.battles.length}`);

    // The verdict, per pick — the same derivation the UI now renders.
    const counts = new Map<string, number>();
    for (const p of f.picks) {
      const st = pickStatus(p, f);
      counts.set(st, (counts.get(st) ?? 0) + 1);
    }
    for (const [st, n] of counts) {
      console.log(`    ${n} × ${st.padEnd(20)} ${STATUS_PRESENTATION[st as keyof typeof STATUS_PRESENTATION].detail}`);
    }
    for (const b of f.battles) {
      console.log(`    battle ${b.state}${b.winnerId ? ` winner=${b.winnerId}` : ""}`);
    }

    // The actionable line.
    if (f.result === "SCHEDULED") {
      console.log(
        "\n  → DIAGNOSIS: no result has been written for this bout, so there is nothing\n" +
        "    to settle. This is a RESULTS gap, not a settlement bug. Ingest a result\n" +
        "    (scripts/run-wikicards.mts) or record it in the admin fight editor —\n" +
        "    settlement now fires on that write, no cron wait.",
      );
    } else if (counts.get("AWAITING_SETTLEMENT")) {
      console.log("\n  → DIAGNOSIS: the result exists and picks are UNGRADED. Invariant violated.\n    Re-run with --repair.");
    } else {
      console.log("\n  → settled. Nothing owed on this bout.");
    }
  }
}

// ── Repair ──────────────────────────────────────────────────────────────────
if (repair) {
  console.log("\n── repairing ───────────────────────────────────────────────");
  const out = await resolveDuePicks();
  const after = await resultOps();
  console.log(`  reconciled fights=${out.fights} picks=${out.picks}`);
  console.log(`  unsettledPicks now ${after.unsettledPicks}, unsettledBattles ${after.unsettledBattles}`);
  if (after.unsettledPicks > 0) {
    console.log("  STILL NON-ZERO — settlement is failing, not lagging. Check the logs for settlement:FAILED.");
  }
}

await prisma.$disconnect();
