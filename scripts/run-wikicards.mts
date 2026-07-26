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
import { harvestWikiTargets, harvestWikiTargetsDetailed } from "../src/lib/scraper/runner.ts";
import { findWikiTargets, findWikiTargetForFight, countWikiGaps, syncWikiCards } from "../src/lib/scraper/wikicard/index.ts";
import { resultOps } from "../src/lib/intelligence/result-ops.ts";
import { PARSE_BUDGET } from "../src/lib/scraper/wikicard/candidates.ts";
import type { WikiMode } from "../src/lib/scraper/wikicard/targets.ts";

const argv = process.argv.slice(2);
const flag = (name: string) => argv.includes(`--${name}`);
/**
 * A flag's value, joining every token up to the next `--flag`.
 *
 * npm strips the quotes from `-- --fight "Anthony Joshua vs Kristian Prenga"`, so the
 * value arrives as five separate argv entries. Reading only argv[i+1] silently
 * searched for "Anthony" and reported no match — a wrong answer that looks like a
 * real one, which is the worst kind.
 */
const value = (name: string) => {
  const i = argv.indexOf(`--${name}`);
  if (i < 0) return undefined;
  const parts: string[] = [];
  for (let j = i + 1; j < argv.length && !argv[j].startsWith("--"); j++) parts.push(argv[j]);
  return parts.length ? parts.join(" ") : undefined;
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

// Contamination check. Before the verified-bouts-only fix, accepting a Wikipedia
// SEASON page attached that page's entire table — every card of the year — to one
// event. A real card is 10–13 bouts; anything past OVERSIZED_CARD is a symptom, not
// a big event. Reported, never auto-deleted: removing bouts could remove real ones.
const OVERSIZED_CARD = 40;
const oversized = await prisma.event.findMany({
  where: { fights: { some: {} } },
  select: { slug: true, name: true, _count: { select: { fights: true } } },
  orderBy: { fights: { _count: "desc" } },
  take: 10,
});
const bloated = oversized.filter((e) => e._count.fights > OVERSIZED_CARD);
if (bloated.length) {
  console.log(`\n  ⚠ ${bloated.length} event(s) carry an implausible number of bouts:`);
  for (const e of bloated) console.log(`      ${e._count.fights} bouts — ${e.name} (${e.slug})`);
  console.log("      A real card is 10-13. This is the season-page over-attach bug;");
  console.log("      inspect before trusting those cards. Nothing is deleted automatically.");
}

// ── EXPLAIN ONE FIGHT: the permanent debugging tool ─────────────────────────
// `--fight "Tyson Fury vs Mariusz Wach" --explain` runs the REAL pipeline for one
// bout and prints every decision. The point is to answer, without guessing, which of
// these happened: the search found nothing · it found something and scoring refused
// it · a page parsed to no card · a card parsed but wasn't our bout · it was ours and
// the page shows no result yet.
const fightQuery = value("fight");
if (fightQuery) {
  const target = await findWikiTargetForFight(fightQuery);
  if (!target) {
    console.log(`
No UNRESOLVED bout matches "${fightQuery}".`);
    console.log("Either it is already settled, or the name does not match. Try: npm run settlement:doctor -- \"<name>\"");
    await prisma.$disconnect();
    process.exit(0);
  }

  console.log(`
── explaining: ${fightQuery} ───────────────────────────────`);
  const h = await syncWikiCards([target]);
  const o = h.report.outcomes[0];

  for (const t of o.trace) {
    const mark = t.stage === "target" ? " " : t.ok ? "✓" : "✗";
    console.log(`  ${mark} ${t.stage.toUpperCase().padEnd(10)} ${t.detail}`);
  }

  console.log(`
  VERDICT: ${o.reason}`);
  const why: Record<string, string> = {
    verified: "the result was found and will be persisted (and settled) on a non-dry run.",
    no_candidate: "A. the source has no page for this bout — the search returned nothing at all.",
    all_rejected: "B/C. the search returned pages, but none scored high enough to be plausibly about this bout.",
    no_card: "D. a page was read but contained no results table this extractor can parse.",
    unverified: "C. a card was parsed, but none of its bouts is the one we are looking for.",
    error: "the source could not be reached.",
  };
  console.log(`  ${why[o.reason] ?? o.reason}`);
  if (o.reason !== "verified") {
    console.log("\n  This is a SOURCE-COVERAGE limit, not a settlement bug: there is nothing");
    console.log("  to write. Nothing is fabricated to close it.");
  }
  await prisma.$disconnect();
  process.exit(0);
}

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
const totals = { targets: 0, verified: 0, written: 0, bouts: 0, searches: 0, parses: 0, rejected: 0, cacheHits: 0 };
const ladder: Record<string, { searched: number; candidates: number; parsed: number; verified: number }> = {};
let awaiting = opsBefore.awaitingResults;

for (let i = 0; i < batches; i++) {
  // `skip` walks the backlog: a batch whose targets all fail would otherwise be
  // re-attempted forever while the rest of the 1,754 never gets looked at.
  const { line, report } = await harvestWikiTargetsDetailed({
    gap: "missing_result",
    limit,
    mode,
    promotion,
    skip: i * limit,
  });
  console.log(`\n  batch ${String(i + 1).padStart(2)} ${line}`);

  if (report) {
    totals.targets += report.targets;
    totals.verified += report.withCard;
    totals.bouts += report.bouts;
    totals.searches += report.queries;
    totals.parses += report.parses;
    totals.rejected += report.rejected;
    totals.cacheHits += report.cacheHits;
    for (const [kind, st] of Object.entries(report.byStrategy)) {
      const acc = (ladder[kind] ??= { searched: 0, candidates: 0, parsed: 0, verified: 0 });
      acc.searched += st.searched; acc.candidates += st.candidates;
      acc.parsed += st.parsed; acc.verified += st.verified;
    }

    // Every accepted page, with the score and signals that accepted it.
    for (const o of report.outcomes) {
      if (o.reason !== "verified") continue;
      const filtered = o.parsedOnPage && o.parsedOnPage > o.bouts ? ` [filtered ${o.parsedOnPage}→${o.bouts}]` : "";
      console.log(`    ACCEPT  ${o.event}`);
      console.log(`            page="${o.page}" via=${o.strategy} score=${o.score} (${(o.reasons ?? []).join(",")})${filtered}`);
    }
    // And a sample of what was refused before any fetch — the saved work, explained.
    for (const o of report.outcomes) {
      for (const r of o.rejectedDetail.slice(0, 3)) {
        console.log(`    reject  "${r.title}" score=${r.score} (${r.reasons.join(",") || "no positive signal"})`);
      }
    }
    for (const o of report.outcomes) {
      if (o.reason === "verified" || o.reason === "no_candidate") continue;
      console.log(`    MISS    ${o.event} — ${o.reason}${o.note ? ` (${o.note})` : ""}`);
    }
  }

  // Backfill progress, per batch — the production metric.
  const now = (await resultOps()).awaitingResults;
  const delta = awaiting - now;
  console.log(`    progress awaitingResults ${awaiting} → ${now} (resolved ${delta}, remaining ${now})`);
  awaiting = now;

  if (line.startsWith("targets=0")) {
    emptyBatches += 1;
    if (emptyBatches >= 2) break; // walked off the end of the backlog
  }
}

// Card backfill (events with no bouts at all) — whatever budget is left.
if (mode !== "replay") {
  const cards = await harvestWikiTargets({ gap: "missing_card", limit, mode });
  console.log(`\n  cards    ${cards}`);
}

// ── RETRIEVAL EFFICIENCY ────────────────────────────────────────────────────
console.log("\n── retrieval ───────────────────────────────────────────────");
console.log(`  targets                 : ${totals.targets}`);
console.log(`  verified                : ${totals.verified}`);
console.log(`  bouts written           : ${totals.bouts}`);
console.log(`  search requests         : ${totals.searches}`);
console.log(`  page parses             : ${totals.parses}`);
console.log(`  rejected candidates     : ${totals.rejected}   (refused on title, never fetched)`);
console.log(`  page-cache hits         : ${totals.cacheHits}   (season pages reused, not re-downloaded)`);
if (totals.targets) {
  console.log(`  searches / target       : ${(totals.searches / totals.targets).toFixed(2)}`);
  console.log(`  parses / target         : ${(totals.parses / totals.targets).toFixed(2)}   (budget ${PARSE_BUDGET})`);
  console.log(`  verification rate       : ${((totals.verified / totals.targets) * 100).toFixed(1)}%`);
}
if (totals.verified) {
  console.log(`  bouts / verified event  : ${(totals.bouts / totals.verified).toFixed(1)}   (a real card is ~10-13)`);
}

console.log("\n  ladder (searched → candidates → parsed → verified):");
for (const [kind, st] of Object.entries(ladder)) {
  const rate = st.parsed ? ((st.verified / st.parsed) * 100).toFixed(0) : "0";
  console.log(`    ${kind.padEnd(16)} ${String(st.searched).padStart(4)} → ${String(st.candidates).padStart(4)} → ${String(st.parsed).padStart(4)} → ${String(st.verified).padStart(4)}   (${rate}% of parses verified)`);
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
