// Bouts for the sports that publish a BRACKET, not a fight card.
//
//   npm run bouts:fill                                  # sambo, taekwondo, bjj, wrestling
//   npm run bouts:fill -- --sport=wrestling --years=5
//   npm run bouts:fill -- --sport=all --divisions=20
//   npm run bouts:fill -- --dry-run                     # harvest + report, write nothing
//   npm run bouts:fill -- --report                      # per-sport table only, no network
//
// LOCAL ONLY — deliberately not wired into runner.ts or any cron route. It walks
// Wikipedia championship pages, reconstructs bouts from the elimination brackets
// (or, where no bracket exists, derives the division final from the medal table)
// and hands them to persistAggregated, which owns dedupe, provenance and settlement.
//
// Re-running is safe. Fight identity is the corner pair on the event, so a second
// run updates rather than duplicates, and the settlement claim is atomic.
//
// The report is a per-sport count BEFORE and AFTER, because "the scraper ran" and
// "the database gained bouts" are different claims and only the second one matters.
import { prisma } from "../src/lib/db.ts";
import { persistAggregated } from "../src/services/sync/persist.ts";
import { syncTournaments } from "../src/lib/scraper/tournament/sync.ts";
import { TOURNAMENT_SOURCES, type TournamentSource } from "../src/lib/scraper/tournament/config.ts";
import type { NormalizedEvent } from "../src/services/providers/types.ts";
import type { Sport } from "../src/lib/types.ts";

// ── args ────────────────────────────────────────────────────────────────────
const argv = process.argv.slice(2);
const flag = (name: string) => argv.includes(`--${name}`);
const value = (name: string): string | undefined => {
  const inline = argv.find((a) => a.startsWith(`--${name}=`));
  if (inline) return inline.slice(name.length + 3);
  const i = argv.indexOf(`--${name}`);
  if (i < 0) return undefined;
  const parts: string[] = [];
  for (let j = i + 1; j < argv.length && !argv[j].startsWith("--"); j++) parts.push(argv[j]);
  return parts.length ? parts.join(" ") : undefined;
};

/** The four the operator asked for. `judo` is wired and one flag away. */
const DEFAULT_KEYS = ["sambo", "taekwondo", "bjj", "wrestling"];

const requested = (value("sport") ?? DEFAULT_KEYS.join(","))
  .split(/[,\s]+/)
  .map((s) => s.trim().toLowerCase())
  .filter(Boolean);

const sources: TournamentSource[] = requested.includes("all")
  ? TOURNAMENT_SOURCES
  : TOURNAMENT_SOURCES.filter((s) => requested.includes(s.key));

const unknown = requested.filter((k) => k !== "all" && !TOURNAMENT_SOURCES.some((s) => s.key === k));
if (unknown.length) {
  console.error(`unknown sport key(s): ${unknown.join(", ")}`);
  console.error(`known: ${TOURNAMENT_SOURCES.map((s) => s.key).join(", ")}, all`);
  process.exit(1);
}
if (!sources.length) {
  console.error("no sources selected");
  process.exit(1);
}

// Four, not three: world championships are annual but the Olympics are not, and
// a three-year window run in mid-season can miss the last completed edition of
// everything. The extra year costs one 404 per hub pattern.
const yearsBack = Math.max(1, Number(value("years") ?? 4));
const maxDivisions = Math.max(1, Number(value("divisions") ?? 12));
const dryRun = flag("dry-run");
const thisYear = new Date().getUTCFullYear();
// Newest first, so a capped run gets the most recent championships.
const years = Array.from({ length: yearsBack }, (_, i) => thisYear - i);

// ── the per-sport picture ───────────────────────────────────────────────────
interface Row {
  sport: string;
  events: number;
  past: number;
  withCard: number;
  noCard: number;
  bouts: number;
  decided: number;
  fighters: number;
}

async function snapshot(): Promise<Map<string, Row>> {
  // enum_range keeps this in step with schema.prisma — a sport added later shows
  // up here as a zero row instead of silently vanishing from the report.
  const rows = await prisma.$queryRaw<
    { sport: string; events: bigint; past: bigint; withcard: bigint; bouts: bigint; decided: bigint }[]
  >`
    SELECT s.sport,
           COUNT(DISTINCT e.id)                                       AS events,
           COUNT(DISTINCT e.id) FILTER (WHERE e.date < now())         AS past,
           COUNT(DISTINCT e.id) FILTER (WHERE f.id IS NOT NULL)       AS withcard,
           COUNT(f.id)                                                AS bouts,
           COUNT(f.id) FILTER (WHERE f.result <> 'SCHEDULED')         AS decided
    FROM (SELECT unnest(enum_range(NULL::"Sport"))::text AS sport) s
    LEFT JOIN "Event" e ON e.sport::text = s.sport
    LEFT JOIN "Fight" f ON f."eventId" = e.id
    GROUP BY s.sport
  `;
  const fighters = await prisma.$queryRaw<{ sport: string; n: bigint }[]>`
    SELECT sport::text AS sport, COUNT(*) AS n FROM "Fighter" GROUP BY sport
  `;
  const byFighter = new Map(fighters.map((f) => [f.sport, Number(f.n)]));

  return new Map(
    rows.map((r) => {
      const events = Number(r.events);
      const withCard = Number(r.withcard);
      return [
        r.sport,
        {
          sport: r.sport,
          events,
          past: Number(r.past),
          withCard,
          noCard: events - withCard,
          bouts: Number(r.bouts),
          decided: Number(r.decided),
          fighters: byFighter.get(r.sport) ?? 0,
        },
      ];
    }),
  );
}

const COLS: { head: string; get: (r: Row) => number }[] = [
  { head: "events", get: (r) => r.events },
  { head: "past", get: (r) => r.past },
  { head: "w/bouts", get: (r) => r.withCard },
  { head: "empty", get: (r) => r.noCard },
  { head: "bouts", get: (r) => r.bouts },
  { head: "decided", get: (r) => r.decided },
  { head: "fighters", get: (r) => r.fighters },
];

/**
 * Column widths are measured from the rendered cells, not fixed.
 *
 * They were fixed, and the AFTER table on the first real run printed
 * "01484+14841429+1429" — three columns fused into one number because
 * "1484+1484" is wider than the 7 characters allowed for it. A report nobody can
 * read is not a report.
 */
function table(title: string, snap: Map<string, Row>, before?: Map<string, Row>): void {
  const rows = [...snap.values()];
  const cell = (row: Row, c: (typeof COLS)[number]): string => {
    const now = c.get(row);
    const prior = before?.get(row.sport);
    if (!prior) return String(now);
    const delta = now - c.get(prior);
    // A delta is only worth ink when something moved.
    return delta > 0 ? `${now} +${delta}` : String(now);
  };

  const rendered = rows.map((r) => COLS.map((c) => cell(r, c)));
  const widths = COLS.map((c, i) =>
    Math.max(c.head.length, ...rendered.map((cells) => cells[i].length)) + 2,
  );
  const nameWidth = Math.max(6, ...rows.map((r) => r.sport.length)) + 2;

  console.log(`\n── ${title} ${"─".repeat(Math.max(0, 66 - title.length))}`);
  console.log("  " + "sport".padEnd(nameWidth) + COLS.map((c, i) => c.head.padStart(widths[i])).join(""));
  console.log("  " + "─".repeat(nameWidth + widths.reduce((n, w) => n + w, 0)));

  rows.forEach((row, ri) => {
    const prior = before?.get(row.sport);
    const touched = prior ? COLS.some((c) => c.get(row) !== c.get(prior)) : row.events > 0;
    const cells = rendered[ri].map((s, i) => s.padStart(widths[i])).join("");
    console.log(`  ${touched ? "▸" : " "} ${row.sport.padEnd(nameWidth - 2)}${cells}`);
  });
}

// ── run ─────────────────────────────────────────────────────────────────────
const [conn] = await prisma.$queryRaw<{ db: string }[]>`SELECT current_database() AS db`;
console.log(`database  : ${conn.db}`);
console.log(`sports    : ${sources.map((s) => s.key).join(", ")}`);
console.log(`years     : ${years.join(", ")}`);
console.log(`divisions : max ${maxDivisions} per championship${dryRun ? "   DRY RUN — nothing will be written" : ""}`);

const before = await snapshot();

// `--report` is the table on its own: what is in the database per sport, right
// now, with no network access at all.
if (flag("report") || flag("status")) {
  table("CURRENT", before);
  await prisma.$disconnect();
  process.exit(0);
}

table("BEFORE", before);

console.log("\n── harvesting ──────────────────────────────────────────────────────");
const { events, report } = await syncTournaments({
  sources,
  years,
  maxDivisions,
  onProgress: (line) => console.log(line),
});

console.log("\n── source coverage ─────────────────────────────────────────────────");
console.log(`  championship pages asked for : ${report.hubsTried}`);
console.log(`  championship pages that exist: ${report.hubsFound}`);
console.log(`  division pages fetched       : ${report.divisionsFetched}`);
console.log(`  bouts read off brackets      : ${report.bracketBouts}`);
console.log(`  finals derived from medals   : ${report.medalBouts}   (gold def. silver — no method, no earlier rounds)`);
console.log(`  events assembled             : ${events.length}`);

if (report.skipped.length) {
  const byReason = new Map<string, number>();
  for (const s of report.skipped) byReason.set(s.why, (byReason.get(s.why) ?? 0) + 1);
  console.log("\n  not usable:");
  for (const [why, n] of [...byReason].sort((a, b) => b[1] - a[1])) {
    console.log(`    ${String(n).padStart(4)}  ${why}`);
  }
}
if (report.warnings.length) {
  console.log(`\n  ⚠ ${report.warnings.length} fetch/parse warning(s):`);
  for (const w of report.warnings.slice(0, 10)) console.log(`      ${w}`);
}

// ── write ───────────────────────────────────────────────────────────────────
if (dryRun) {
  console.log("\n── what WOULD be written (dry run) ─────────────────────────────────");
  for (const ev of events.slice(0, 40)) {
    const decided = (ev.fights ?? []).filter((f) => f.result !== "SCHEDULED").length;
    console.log(`  ${ev.sport.padEnd(13)} ${ev.date.slice(0, 10)}  ${String(ev.fights?.length ?? 0).padStart(3)} bouts (${decided} decided)  ${ev.name}`);
  }
  if (events.length > 40) console.log(`  … and ${events.length - 40} more`);
  await prisma.$disconnect();
  process.exit(0);
}

console.log("\n── writing ─────────────────────────────────────────────────────────");
const bySport = new Map<Sport, NormalizedEvent[]>();
for (const ev of events) {
  const list = bySport.get(ev.sport) ?? [];
  list.push(ev);
  bySport.set(ev.sport, list);
}
let written = 0;
for (const [sport, list] of bySport) {
  const n = await persistAggregated(sport, "events", list);
  written += n;
  console.log(`  ${sport.padEnd(14)} ${String(n).padStart(3)}/${String(list.length).padStart(3)} events persisted`);
}

// ── after ───────────────────────────────────────────────────────────────────
const after = await snapshot();
table("AFTER (delta vs before)", after, before);

const gained = (pick: (r: Row) => number) =>
  [...after.values()].reduce((n, r) => n + pick(r), 0) - [...before.values()].reduce((n, r) => n + pick(r), 0);

console.log("\n── net ─────────────────────────────────────────────────────────────");
console.log(`  events   +${gained((r) => r.events)}`);
console.log(`  bouts    +${gained((r) => r.bouts)}`);
console.log(`  decided  +${gained((r) => r.decided)}`);
console.log(`  fighters +${gained((r) => r.fighters)}`);
console.log(`  (${written} event upserts reported by the persistence layer)`);

// A harvest that produced events and wrote none is a WRITE failure, and must not
// be reported as though the source came up short.
//
// It read as one once: every upsert threw "the column `resultAttempts` does not
// exist" against a database that had never been `db push`ed, persistAggregated
// logged each failure at warn and returned 0, and the summary below calmly
// announced a source-coverage limit for 31 events that had been harvested
// perfectly. Blaming the source for our own schema drift is the same class of
// mistake as a cron reporting 200 for a run in which everything failed.
if (events.length > 0 && written === 0) {
  console.log(
    "\n  ✗ HARVEST OK, WRITES FAILED. " +
      `${events.length} event(s) were assembled and none was persisted.` +
      "\n    This is NOT a source-coverage limit. persistAggregated logs the reason per event" +
      "\n    at warn level — re-run without LOG_LEVEL set to see it." +
      "\n    If it names a missing column, the database is behind schema.prisma: npx prisma db push",
  );
} else {
  const stillEmpty = [...after.values()].filter((r) => sources.some((s) => s.sport === r.sport) && r.bouts === 0);
  if (stillEmpty.length) {
    console.log(
      `\n  Still with no bouts: ${stillEmpty.map((r) => r.sport).join(", ")}.` +
        "\n  That is a source-coverage limit, not a silent failure — see 'not usable' above." +
        "\n  Nothing is fabricated to close it.",
    );
  }
}

await prisma.$disconnect();
