// Remove bouts a bad Wikipedia import attached to the wrong event. DRY RUN BY DEFAULT.
//
//   npm run cleanup:wikicards                          # dry run — writes nothing
//   npm run cleanup:wikicards -- --since 2026-07-27T12:00:00Z
//   npm run cleanup:wikicards -- --event bkfc-91
//   npm run cleanup:wikicards -- --apply               # after reading the dry run
//
// SAFETY, in order:
//   • Dry run is the default. --apply is the only thing that writes.
//   • Before deleting, every row is exported to a timestamped JSON file. That file IS
//     the rollback point — it holds enough to re-create each bout.
//   • Only bouts the audit marked SUSPECT are touched: written by the aggregated
//     pipeline, inside the audited window, and referenced by nothing. A bout carrying
//     a pick, battle, prediction or odds is never a candidate.
//   • Referential integrity is re-checked immediately before each delete, inside the
//     transaction — the audit may be minutes old and a pick may have landed since.
//   • Prefers false negatives: an uncertain bout is kept.
import { writeFileSync } from "node:fs";
import { prisma } from "../src/lib/db.ts";
import { auditWikicards, auditEventBySlug, type EventAudit } from "../src/lib/scraper/wikicard/audit.ts";

const argv = process.argv.slice(2);
const val = (n: string) => { const i = argv.indexOf(`--${n}`); return i >= 0 ? argv[i + 1] : undefined; };
const apply = argv.includes("--apply");
const since = val("since") ? new Date(val("since")!) : undefined;
const eventSlug = val("event");
const minBouts = val("min") ? Number(val("min")) : undefined;

const [conn] = await prisma.$queryRaw<{ db: string }[]>`SELECT current_database() AS db`;
console.log(`database : ${conn.db}`);
console.log(`mode     : ${apply ? "APPLY — this run WILL delete" : "DRY RUN — nothing will be written"}`);
if (since) console.log(`window   : bouts created on/after ${since.toISOString()}`);
console.log("");

const audits: EventAudit[] = eventSlug
  ? [await auditEventBySlug(eventSlug, { since, minBouts: 0 })].filter(Boolean) as EventAudit[]
  : await auditWikicards({ since, minBouts });

const targets = audits.filter((a) => a.suspectCount > 0);
if (!targets.length) {
  console.log("✓ Nothing to clean up. No event has removable bouts.");
  await prisma.$disconnect();
  process.exit(0);
}

let wouldRemove = 0, wouldKeep = 0;
for (const a of targets) {
  const keep = a.boutCount - a.suspectCount;
  wouldRemove += a.suspectCount;
  wouldKeep += keep;
  console.log(`${a.name}  (${a.slug})`);
  console.log(`    current bouts   : ${a.boutCount}`);
  console.log(`    would remove    : ${a.suspectCount}`);
  console.log(`    would keep      : ${keep}   (of which ${a.protectedCount} protected by references)`);
  for (const b of a.bouts.filter((x) => x.suspect).slice(0, 8)) {
    console.log(`      - ${b.red} vs ${b.blue} [${b.result}] ${b.source ?? "no-provenance"}`);
  }
  if (a.suspectCount > 8) console.log(`      … ${a.suspectCount - 8} more`);
  console.log("");
}

console.log("── totals ──────────────────────────────────────────────────");
console.log(`  events        : ${targets.length}`);
console.log(`  would remove  : ${wouldRemove}`);
console.log(`  would keep    : ${wouldKeep}`);

if (!apply) {
  console.log("\n  DRY RUN — nothing was written. Re-run with --apply to execute.");
  await prisma.$disconnect();
  process.exit(0);
}

// ── BACKUP FIRST ────────────────────────────────────────────────────────────
// Written before a single row is deleted, and it is the rollback point.
const stamp = (await prisma.$queryRaw<{ now: Date }[]>`SELECT now() AS now`)[0].now
  .toISOString().replace(/[:.]/g, "-");
const backupPath = `wikicard-cleanup-backup-${stamp}.json`;
const ids = targets.flatMap((a) => a.bouts.filter((b) => b.suspect).map((b) => b.id));
const backup = await prisma.fight.findMany({ where: { id: { in: ids } } });
writeFileSync(backupPath, JSON.stringify({ database: conn.db, takenAt: stamp, fights: backup }, null, 2));
console.log(`\n  backup written : ${backupPath}  (${backup.length} rows — this is your rollback point)`);

// ── DELETE ──────────────────────────────────────────────────────────────────
let removed = 0, aborted = 0;
for (const a of targets) {
  for (const b of a.bouts.filter((x) => x.suspect)) {
    // Re-check inside the transaction. The audit is minutes old and a reader may
    // have picked this bout since; a stale plan must never delete live user data.
    const done = await prisma.$transaction(async (tx) => {
      const fresh = await tx.fight.findUnique({
        where: { id: b.id },
        select: { id: true, _count: { select: { picks: true, battles: true, predictions: true, odds: true } } },
      });
      if (!fresh) return "gone";
      const c = fresh._count;
      if (c.picks || c.battles || c.predictions || c.odds) return "abort";
      await tx.fight.delete({ where: { id: b.id } });
      return "removed";
    });
    if (done === "removed") removed += 1;
    else if (done === "abort") {
      aborted += 1;
      console.log(`    ABORTED ${b.red} vs ${b.blue} — acquired a reference since the audit`);
    }
  }
}

console.log(`\n  removed : ${removed}`);
if (aborted) console.log(`  kept    : ${aborted} (gained references between audit and delete)`);
console.log("\n  Now re-run: npm run audit:wikicards");
await prisma.$disconnect();
