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
import { STATIC_IMPORT_SOURCES } from "../src/lib/scraper/source-policy.ts";
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
console.log(`  events missing results  : ${before.missingResultEvents}   (queueable)`);
console.log(`  events missing a card   : ${before.missingCardEvents}   (queueable)`);
console.log(`  unsettledPicks          : ${opsBefore.unsettledPicks}`);
// Parked, stated rather than hidden. These are NOT in the counts above, and a
// number that quietly excludes things is how a permanent miss looks like health.
console.log(`  parked: complete cards  : ${before.parkedComplete}   (every bout decided — nothing left to learn)`);
console.log(`  parked: static imports  : ${before.parkedStaticSource}   (one-shot sources; see lib/scraper/source-policy)`);

// Contamination check. Before the verified-bouts-only fix, accepting a Wikipedia
// SEASON page attached that page's entire table — every card of the year — to one
// event. A real card is 10–13 bouts; anything past OVERSIZED_CARD is a symptom, not
// a big event. Reported, never auto-deleted: removing bouts could remove real ones.
const OVERSIZED_CARD = 40;
const oversized = await prisma.event.findMany({
  where: {
    fights: { some: {} },
    // Tournament divisions are legitimately huge — a World Taekwondo weight class
    // runs to ~72 bouts — so they tripped this every run and buried the real
    // signal under ten false alarms. The heuristic is about MMA/boxing cards
    // over-attaching a Wikipedia SEASON page; a bracket import is a different
    // shape of thing and is excluded by its source, not by raising the threshold.
    NOT: { externalIds: { some: { source: { in: STATIC_IMPORT_SOURCES } } } },
  },
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
    partial: "some of the card was reconstructed, but not enough of it to call the event complete.",
    name_mismatch:
      "E. the source HAS this bout on the right date, under a name we failed to match.",
    no_candidate: "A. the source has no page for this bout — the search returned nothing at all.",
    all_rejected: "B/C. the search returned pages, but none scored high enough to be plausibly about this bout.",
    no_card: "D. a page was read but contained no results table this extractor can parse.",
    unverified: "C. a card was parsed, but none of its bouts is the one we are looking for.",
    error: "the source could not be reached.",
  };
  console.log(`  ${why[o.reason] ?? o.reason}`);
  if (o.note) console.log(`  ${o.note}`);

  // Do NOT call a name mismatch a source-coverage limit.
  //
  // This block printed "SOURCE-COVERAGE limit … there is nothing to write" for every
  // non-verified reason, including the one case where the source demonstrably DOES
  // have the result. The trace said "record has 1 row near 2026-07-27 but the opponent
  // is not our fighter: Ricardo Salas" and the verdict two lines later said there was
  // nothing to find — sending the reader to look for a page that was already open.
  if (o.reason === "name_mismatch") {
    console.log("\n  This is OURS to fix, not a source gap. The bout is published; entity");
    console.log("  resolution did not match the name. Add a FighterAlias for the form above,");
    console.log("  or extend the ladder in src/lib/entities/resolve.ts.");
  } else if (o.reason !== "verified" && o.reason !== "partial") {
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

// ── CARD BACKFILL (events with no bouts at all) ─────────────────────────────
//
// This ran ONCE, for one batch of `limit`, unfiltered, and not at all in replay
// mode. Three consequences, all of which we measured:
//   · `--replay "ONE"` — the one command you would reach for to fix a named
//     promotion's empty cards — skipped the card queue entirely, so it could
//     never fill an empty card. It only ever chased missing RESULTS.
//   · The promotion filter was accepted, printed in the header, and then not
//     passed here, so even `--historical` spent its single card batch on
//     whatever was newest across all promotions.
//   · One batch of 25 against a 97-event backlog cannot finish, and with the
//     old `date desc` ordering (fixed in targets.ts) it re-attempted the same
//     25 every run.
//
// It now batches like the result loop and carries the filter, so the backlog
// actually drains and `--replay "<promotion>"` means what it says.
console.log("\n── cards ───────────────────────────────────────────────────");
// NO `skip` here, deliberately — the result loop above uses one, and copying it
// would be wrong now that the card queue rotates. Rotation already guarantees
// forward progress: a batch stamps `resultAttemptAt` on the 25 it attempted,
// which sends them to the back, so the next batch at offset 0 IS the next 25.
// Adding skip on top of that would step over the 25 the rotation just promoted
// and leave a hole in every pass.
//
// Bounded by the actual backlog rather than the batch count, so we walk the
// queue once instead of cycling back onto events this run already tried.
const cardBatches = Math.min(batches, Math.max(1, Math.ceil(before.missingCardEvents / limit)));
let emptyCardBatches = 0;
for (let i = 0; i < cardBatches; i++) {
  const line = await harvestWikiTargets({ gap: "missing_card", limit, mode, promotion });
  console.log(`  batch ${String(i + 1).padStart(2)} ${line}`);
  if (line.startsWith("targets=0")) {
    emptyCardBatches += 1;
    if (emptyCardBatches >= 2) break; // walked off the end of the backlog
  }
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
console.log(`  parked: complete cards  : ${before.parkedComplete} → ${after.parkedComplete}`);
console.log(`  parked: static imports  : ${before.parkedStaticSource} → ${after.parkedStaticSource}`);
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
