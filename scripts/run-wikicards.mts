// Backfill fight cards + RESULTS from Wikipedia (CC BY-SA). Promotion-agnostic.
//
//   npm run results:backfill                       # incremental (recent window)
//   npm run results:backfill -- --historical        # every unresolved bout, any age
//   npm run results:backfill -- --replay "bkfc"     # one promotion / event name
//   npm run results:backfill -- --historical --limit 40 --batches 20
//   npm run results:backfill -- --dry-run           # show targets + ladders, fetch nothing
//
// Three modes, because a 12-hour lag and a 1,754-bout historical debt are different
// problems and must not share one hard-coded window:
//   incremental — RESULTS_BACKFILL_WINDOW_DAYS (default 21). What the cron runs.
//   historical  — no time bound. Walks the whole backlog in batches.
//   replay      — historical + a promotion/event filter. Targeted re-attempt.
//
// Every write goes through persistAggregated, which fires settlement for any bout it
// decides — so a repaired result grades its predictions, resolves its battles, awards
// reputation and invalidates caches in the same pass. Re-running is safe: fight
// identity is the corner pair (no duplicates) and the settlement claim is atomic (no
// double payout).
//
// It NEVER writes a result no source published.
import { prisma } from "../src/lib/db.ts";
import { isSourceEnabled } from "../src/lib/ingestion-registry.ts";
import { harvestWikiTargets } from "../src/lib/scraper/runner.ts";
import { findWikiTargets, countWikiGaps } from "../src/lib/scraper/wikicard/index.ts";
import { resultOps } from "../src/lib/intelligence/result-ops.ts";
import type { WikiMode } from "../src/lib/scraper/wikicard/targets.ts";

const argv = process.argv.slice(2);
const flag = (name: string) => argv.includes(`--${name}`);
const value = (name: string) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? argv[i + 1] : undefined;
};

const mode: WikiMode = flag("historical") ? "historical" : flag("replay") ? "replay" : "incremental";
const promotion = value("replay") ?? value("promotion");
const limit = Number(value("limit") ?? 25);
const batches = Number(value("batches") ?? (mode === "incremental" ? 1 : 10));
const dryRun = flag("dry-run");

if (!isSourceEnabled("wikipedia-facts")) {
  console.error("wikipedia-facts is DISABLED in the ingestion registry — aborting.");
  process.exit(1);
}

const [conn] = await prisma.$queryRaw<{ db: string }[]>`SELECT current_database() AS db`;
console.log(`database : ${conn.db}`);
console.log(`mode     : ${mode}${promotion ? ` filter="${promotion}"` : ""} limit=${limit} batches=${batches}${dryRun ? " DRY RUN" : ""}`);

// ── BEFORE ──────────────────────────────────────────────────────────────────
const before = await countWikiGaps();
const opsBefore = await resultOps();
console.log("\n── before ──────────────────────────────────────────────────");
console.log(`  awaitingResults (bouts) : ${opsBefore.awaitingResults}`);
console.log(`  events missing results  : ${before.missingResultEvents}`);
console.log(`  events missing a card   : ${before.missingCardEvents}`);
console.log(`  unsettledPicks          : ${opsBefore.unsettledPicks}`);

// ── DRY RUN: show what would be searched, fetch nothing ─────────────────────
if (dryRun) {
  const targets = await findWikiTargets({ mode, promotion, limit });
  console.log(`\n── ${targets.length} target(s), with their search ladders ──`);
  for (const t of targets) {
    console.log(`\n  ${t.eventIdentity.name}  (${t.eventIdentity.date.slice(0, 10)})`);
    console.log(`    expected bouts: ${t.expectedBouts.map((b) => `${b.red.name} v ${b.blue.name}`).join(" · ") || "—"}`);
    for (const s of t.searchIdentity) console.log(`    ${s.kind.padEnd(16)} "${s.query}"`);
  }
  await prisma.$disconnect();
  process.exit(0);
}

// ── REPAIR ──────────────────────────────────────────────────────────────────
console.log("\n── repairing ───────────────────────────────────────────────");
let emptyBatches = 0;
for (let i = 0; i < batches; i++) {
  // `skip` walks the backlog: a batch whose targets all fail would otherwise be
  // re-attempted forever while the rest of the 1,754 never gets looked at.
  const line = await harvestWikiTargets({
    gap: "missing_result",
    limit,
    mode,
    promotion,
    skip: i * limit,
  });
  console.log(`  batch ${String(i + 1).padStart(2)} ${line}`);
  if (line.startsWith("targets=0")) {
    emptyBatches += 1;
    if (emptyBatches >= 2) break; // walked off the end of the backlog
  }
}

// Card backfill (events with no bouts at all) — whatever budget is left.
if (mode !== "replay") {
  const cards = await harvestWikiTargets({ gap: "missing_card", limit, mode });
  console.log(`  cards    ${cards}`);
}

// ── AFTER ───────────────────────────────────────────────────────────────────
const after = await countWikiGaps();
const opsAfter = await resultOps();
const fights = await prisma.fight.count();

console.log("\n── after ───────────────────────────────────────────────────");
console.log(`  awaitingResults (bouts) : ${opsBefore.awaitingResults} → ${opsAfter.awaitingResults}  (${opsAfter.awaitingResults - opsBefore.awaitingResults})`);
console.log(`  events missing results  : ${before.missingResultEvents} → ${after.missingResultEvents}`);
console.log(`  events missing a card   : ${before.missingCardEvents} → ${after.missingCardEvents}`);
console.log(`  total fight rows        : ${fights}  (duplicates are prevented by corner-pair identity)`);
console.log(`  unsettledPicks          : ${opsBefore.unsettledPicks} → ${opsAfter.unsettledPicks}  (MUST be 0)`);
console.log(`  unsettledBattles        : ${opsAfter.unsettledBattles}  (MUST be 0)`);

if (opsAfter.unsettledPicks > 0) {
  console.log("\n  WARNING: unsettledPicks is non-zero — a result was written and its picks");
  console.log("  were not graded. Run: npm run settlement:doctor -- --repair");
}
console.log(
  `\n  Still unavailable: ${opsAfter.awaitingResults} bouts have no public verified result we could` +
  "\n  find. That is a source-coverage limit, not a bug — nothing is fabricated to close it.",
);

await prisma.$disconnect();
