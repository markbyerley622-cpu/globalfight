// PRODUCTION SIGN-OFF — the per-sport coverage matrix.
//
//   npm run audit:launch
//   npm run audit:launch -- --json     # machine-readable
//
// Read-only. No network. Every number is COUNTED from the database; nothing is
// inferred and nothing is estimated. Where a column cannot be answered from the
// database it prints "—" rather than a zero, because a zero that actually means
// "not measured" is how a gap gets signed off as covered.
//
// Two attribution rules, stated once because every column depends on them:
//
//   FIGHTERS are counted by `sports[]` (the verified discipline array), NOT by
//   the legacy scalar `sport`. `sport` is whatever the importing provider
//   happened to label the row, so a ONE Muay Thai fighter imported through the
//   MMA pipeline is MMA there and Muay Thai in `sports[]`. The scalar count is
//   printed alongside as `legacy` precisely so a drift between the two is
//   visible — that drift IS the sports[] backfill debt.
//
//   BOUTS are counted by the EVENT's sport, with the bout's own `ruleset`
//   reported separately. A bout's discipline is a property of the bout; until
//   ruleset coverage is complete the event is the only attribution that exists
//   for every row.
import { prisma } from "../src/lib/db.ts";
import { SPORTS } from "../src/lib/sports.ts";
import { CURATED_P4P } from "../src/lib/rankings/curated/lists.ts";

const asJson = process.argv.includes("--json");
const now = new Date();

type SportKey = (typeof SPORTS)[number]["value"];
const SPORT_VALUES = SPORTS.map((s) => s.value) as SportKey[];

// ── raw aggregates, one query per shape (not one per sport) ─────────────────

const fighterBySports = await prisma.$queryRaw<{ sport: string; n: bigint; withImage: bigint }[]>`
  SELECT s AS sport,
         COUNT(*) AS n,
         COUNT(*) FILTER (WHERE "imageUrl" IS NOT NULL OR "thumbUrl" IS NOT NULL) AS "withImage"
  FROM "Fighter", UNNEST("sports") AS s
  GROUP BY s
`;

const fighterByLegacy = await prisma.$queryRaw<{ sport: string; n: bigint }[]>`
  SELECT sport::text AS sport, COUNT(*) AS n FROM "Fighter" GROUP BY sport
`;

// Fighters with an EMPTY sports[] are invisible to every discipline-filtered
// screen (rankings, directory, search) no matter what `sport` says. This is the
// single number that decides whether the directory can be trusted.
const orphanFighters = await prisma.$queryRaw<{ sport: string; n: bigint }[]>`
  SELECT sport::text AS sport, COUNT(*) AS n
  FROM "Fighter" WHERE "sports" = '{}' OR "sports" IS NULL
  GROUP BY sport
`;

const eventsBySport = await prisma.$queryRaw<{
  sport: string; total: bigint; past: bigint; upcoming: bigint;
  first: Date | null; latest: Date | null; next: Date | null;
}[]>`
  SELECT sport::text AS sport,
         COUNT(*) AS total,
         COUNT(*) FILTER (WHERE date < NOW()) AS past,
         COUNT(*) FILTER (WHERE date >= NOW()) AS upcoming,
         MIN(date) AS first,
         MAX(date) FILTER (WHERE date < NOW()) AS latest,
         MIN(date) FILTER (WHERE date >= NOW()) AS next
  FROM "Event" GROUP BY sport
`;

const boutsBySport = await prisma.$queryRaw<{
  sport: string; total: bigint; decided: bigint; scheduled: bigint; title: bigint; ruleset: bigint;
}[]>`
  SELECT e.sport::text AS sport,
         COUNT(*) AS total,
         COUNT(*) FILTER (WHERE f.result <> 'SCHEDULED') AS decided,
         COUNT(*) FILTER (WHERE f.result = 'SCHEDULED') AS scheduled,
         COUNT(*) FILTER (WHERE f."titleFight") AS title,
         COUNT(*) FILTER (WHERE f.ruleset <> 'UNKNOWN') AS ruleset
  FROM "Fight" f JOIN "Event" e ON e.id = f."eventId"
  GROUP BY e.sport
`;

// Bouts on NO event at all — they exist, but no sport can be attributed to them
// and they appear on no card. Counted globally so they cannot hide inside a
// per-sport row that looks healthy.
const orphanBouts = await prisma.fight.count({ where: { eventId: null } });

// Rankings, split by the two things that decide whether a row is PUBLISHED:
// divisional vs P4P, and source (repo.prisma excludes source='generated' from
// every public read, so a generated row is invisible however many there are).
const rankingsBySport = await prisma.$queryRaw<{
  sport: string; total: bigint; p4p: bigint; divisional: bigint; publishable: bigint; generated: bigint;
}[]>`
  SELECT w.sport::text AS sport,
         COUNT(*) AS total,
         COUNT(*) FILTER (WHERE r."isPoundForPound") AS p4p,
         COUNT(*) FILTER (WHERE NOT r."isPoundForPound") AS divisional,
         COUNT(*) FILTER (WHERE r.source <> 'generated') AS publishable,
         COUNT(*) FILTER (WHERE r.source = 'generated') AS generated
  FROM "Ranking" r JOIN "WeightClass" w ON w.id = r."weightClassId"
  GROUP BY w.sport
`;

const weightClassesBySport = await prisma.$queryRaw<{ sport: string; n: bigint }[]>`
  SELECT sport::text AS sport, COUNT(*) AS n FROM "WeightClass"
  WHERE slug NOT LIKE 'p4p-%' AND slug <> 'pound-for-pound'
  GROUP BY sport
`;

const championsBySport = await prisma.$queryRaw<{ sport: string; n: bigint }[]>`
  SELECT w.sport::text AS sport, COUNT(*) AS n
  FROM "Champion" c JOIN "WeightClass" w ON w.id = c."weightClassId"
  GROUP BY w.sport
`.catch(() => [] as { sport: string; n: bigint }[]);

const curatedSports = new Set(CURATED_P4P.map((l) => l.sport));

// ── shape it per sport ──────────────────────────────────────────────────────

const idx = <T extends { sport: string }>(rows: T[]) => new Map(rows.map((r) => [r.sport, r]));
const F = idx(fighterBySports), L = idx(fighterByLegacy), O = idx(orphanFighters);
const E = idx(eventsBySport), B = idx(boutsBySport), R = idx(rankingsBySport);
const W = idx(weightClassesBySport), C = idx(championsBySport);
const n = (v: bigint | undefined) => Number(v ?? 0n);
const d = (v: Date | null | undefined) => (v ? v.toISOString().slice(0, 10) : "—");

const rows = SPORT_VALUES.map((sport) => {
  const f = F.get(sport), e = E.get(sport), b = B.get(sport), r = R.get(sport);
  const fighters = n(f?.n);
  const bouts = n(b?.total);
  return {
    sport,
    fighters,
    legacyFighters: n(L.get(sport)?.n),
    orphanFighters: n(O.get(sport)?.n),
    imagePct: fighters ? Math.round((n(f?.withImage) / fighters) * 100) : null,
    eventsPast: n(e?.past),
    eventsUpcoming: n(e?.upcoming),
    boutsDecided: n(b?.decided),
    boutsScheduled: n(b?.scheduled),
    titleFights: n(b?.title),
    rulesetPct: bouts ? Math.round((n(b?.ruleset) / bouts) * 100) : null,
    champions: n(C.get(sport)?.n),
    weightClasses: n(W.get(sport)?.n),
    rankingsPublishable: n(r?.publishable),
    rankingsGenerated: n(r?.generated),
    rankingsP4P: n(r?.p4p),
    curatedList: curatedSports.has(sport),
    firstEvent: d(e?.first),
    latestEvent: d(e?.latest),
    nextEvent: d(e?.next),
  };
});

if (asJson) {
  process.stdout.write(JSON.stringify({ generatedAt: now.toISOString(), orphanBouts, rows }, null, 2) + "\n");
  await prisma.$disconnect();
  process.exit(0);
}

// ── report ──────────────────────────────────────────────────────────────────

const pad = (s: string | number, w: number) => String(s).padStart(w);
const padr = (s: string | number, w: number) => String(s).padEnd(w);
const pct = (v: number | null) => (v === null ? "  —" : pad(v + "%", 4));

process.stdout.write(`\nLAUNCH COVERAGE MATRIX — ${now.toISOString().slice(0, 16)}Z\n`);
process.stdout.write(`${"─".repeat(112)}\n`);
process.stdout.write(
  `${padr("SPORT", 14)}${pad("FGHTR", 6)}${pad("IMG", 5)}${pad("PAST", 6)}${pad("UPCM", 5)}` +
  `${pad("DEC", 7)}${pad("SCHD", 6)}${pad("TITLE", 6)}${pad("RULE", 6)}${pad("WC", 4)}` +
  `${pad("RANK", 6)}${pad("GEN", 5)}  ${padr("FIRST", 11)}${padr("LATEST", 11)}${padr("NEXT", 11)}\n`,
);
process.stdout.write(`${"─".repeat(112)}\n`);

for (const r of rows) {
  process.stdout.write(
    `${padr(r.sport, 14)}${pad(r.fighters, 6)}${pct(r.imagePct).padStart(5)}${pad(r.eventsPast, 6)}${pad(r.eventsUpcoming, 5)}` +
    `${pad(r.boutsDecided, 7)}${pad(r.boutsScheduled, 6)}${pad(r.titleFights, 6)}${pct(r.rulesetPct).padStart(6)}${pad(r.weightClasses, 4)}` +
    `${pad(r.rankingsPublishable, 6)}${pad(r.rankingsGenerated, 5)}  ${padr(r.firstEvent, 11)}${padr(r.latestEvent, 11)}${padr(r.nextEvent, 11)}\n`,
  );
}
process.stdout.write(`${"─".repeat(112)}\n`);
process.stdout.write(
  `FGHTR = fighters with this discipline in sports[] · IMG = % with a photo · DEC/SCHD = decided/scheduled bouts\n` +
  `RULE = % of bouts with a known ruleset · WC = divisional weight classes · RANK = PUBLISHABLE ranking rows\n` +
  `GEN = generated ranking rows (excluded from every public read — they render as nothing)\n`,
);

// ── the blockers, stated as blockers ────────────────────────────────────────

process.stdout.write(`\nBLOCKERS\n${"─".repeat(112)}\n`);
const blockers: string[] = [];

for (const r of rows) {
  if (r.fighters === 0 && r.legacyFighters > 0)
    blockers.push(`${r.sport}: ${r.legacyFighters} fighters carry sport='${r.sport}' but NONE have it in sports[] — invisible to every discipline-filtered screen.`);
  if (r.orphanFighters > 0)
    blockers.push(`${r.sport}: ${r.orphanFighters} fighters have an EMPTY sports[] — they exist but appear in no directory, ranking or search filter.`);
  if (r.rankingsPublishable === 0)
    blockers.push(`${r.sport}: 0 publishable ranking rows${r.rankingsGenerated ? ` (${r.rankingsGenerated} generated rows exist but are excluded from public reads by design)` : ""}${r.curatedList ? "" : " and no curated P4P list"} — the rankings page renders its empty state.`);
  if (r.eventsPast > 0 && r.boutsDecided === 0)
    blockers.push(`${r.sport}: ${r.eventsPast} past events but ZERO decided bouts — results ingestion has never succeeded for this sport.`);
  if (r.eventsUpcoming === 0)
    blockers.push(`${r.sport}: no upcoming events — the schedule surface is empty for this discipline.`);
  if (r.fighters > 0 && (r.imagePct ?? 0) < 25)
    blockers.push(`${r.sport}: only ${r.imagePct}% of ${r.fighters} fighters have a photo.`);
}
if (orphanBouts > 0)
  blockers.push(`GLOBAL: ${orphanBouts} bouts have no event — they belong to no card and no sport.`);

if (blockers.length === 0) process.stdout.write("  none\n");
else blockers.forEach((b, i) => process.stdout.write(`  ${pad(i + 1, 2)}. ${b}\n`));

process.stdout.write(`\n${blockers.length} blocker(s).\n`);
await prisma.$disconnect();
