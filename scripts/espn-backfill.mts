// Full cards WITH results for the major MMA promotions, from ESPN's public JSON.
//
//   npm run espn:backfill                          # ufc, pfl, bellator, one, rizin — 3 years
//   npm run espn:backfill -- --years=10
//   npm run espn:backfill -- --league=ufc --years=15
//   npm run espn:backfill -- --league=all --years=5
//   npm run espn:backfill -- --dry-run
//
// One request per league-year, whole card inline. This is the source that fixes
// "promotion X has events with 0 bouts": ESPN publishes every bout, both corners
// with stable athlete ids, the weight class and the winner.
//
// Re-running is safe — fight identity is the corner pair on the event.
//
// Prints the promotion table before and after, because "the scraper ran" and "the
// promotion's cards are no longer empty" are different claims.
import { prisma } from "../src/lib/db.ts";
import { persistAggregated } from "../src/services/sync/persist.ts";
import { syncEspn } from "../src/lib/scraper/espn/sync.ts";
import { ESPN_LEAGUES, DEFAULT_LEAGUE_KEYS, type EspnLeague } from "../src/lib/scraper/espn/leagues.ts";
import type { NormalizedEvent } from "../src/services/providers/types.ts";
import type { Sport } from "../src/lib/types.ts";

const argv = process.argv.slice(2);
const flag = (n: string) => argv.includes(`--${n}`);
const value = (n: string): string | undefined => {
  const inline = argv.find((a) => a.startsWith(`--${n}=`));
  if (inline) return inline.slice(n.length + 3);
  const i = argv.indexOf(`--${n}`);
  if (i < 0) return undefined;
  const parts: string[] = [];
  for (let j = i + 1; j < argv.length && !argv[j].startsWith("--"); j++) parts.push(argv[j]);
  return parts.length ? parts.join(" ") : undefined;
};

const requested = (value("league") ?? DEFAULT_LEAGUE_KEYS.join(","))
  .split(/[,\s]+/).map((s) => s.trim().toLowerCase()).filter(Boolean);

const leagues: EspnLeague[] = requested.includes("all")
  ? ESPN_LEAGUES
  : ESPN_LEAGUES.filter((l) => requested.includes(l.key));

const unknown = requested.filter((k) => k !== "all" && !ESPN_LEAGUES.some((l) => l.key === k));
if (unknown.length) {
  console.error(`unknown league key(s): ${unknown.join(", ")}`);
  console.error(`known: ${ESPN_LEAGUES.map((l) => l.key).join(", ")}, all`);
  process.exit(1);
}
if (!leagues.length) { console.error("no leagues selected"); process.exit(1); }

const yearsBack = Math.max(1, Number(value("years") ?? 3));
const dryRun = flag("dry-run");
const thisYear = new Date().getUTCFullYear();
const years = Array.from({ length: yearsBack }, (_, i) => thisYear - i);

// ── the promotion picture ───────────────────────────────────────────────────
interface Row { promotion: string; events: number; filled: number; empty: number; bouts: number; decided: number }

async function snapshot(): Promise<Map<string, Row>> {
  const rows = await prisma.$queryRaw<
    { promotion: string; events: bigint; filled: bigint; bouts: bigint; decided: bigint }[]
  >`
    SELECT COALESCE(e.promotion, '— unattributed —')                  AS promotion,
           COUNT(DISTINCT e.id)                                       AS events,
           COUNT(DISTINCT e.id) FILTER (WHERE f.id IS NOT NULL)       AS filled,
           COUNT(f.id)                                                AS bouts,
           COUNT(f.id) FILTER (WHERE f.result <> 'SCHEDULED')         AS decided
    FROM "Event" e
    LEFT JOIN "Fight" f ON f."eventId" = e.id
    WHERE e.date < now()
      AND e.status NOT IN ('DRAFT', 'CANCELLED', 'POSTPONED')
    GROUP BY 1
  `;
  return new Map(rows.map((r) => {
    const events = Number(r.events);
    const filled = Number(r.filled);
    return [r.promotion, {
      promotion: r.promotion, events, filled, empty: events - filled,
      bouts: Number(r.bouts), decided: Number(r.decided),
    }];
  }));
}

const COLS: { head: string; get: (r: Row) => number }[] = [
  { head: "events", get: (r) => r.events },
  { head: "filled", get: (r) => r.filled },
  { head: "empty", get: (r) => r.empty },
  { head: "bouts", get: (r) => r.bouts },
  { head: "decided", get: (r) => r.decided },
];

function table(title: string, snap: Map<string, Row>, before?: Map<string, Row>): void {
  const rows = [...snap.values()].sort((a, b) => b.events - a.events);
  const cell = (row: Row, c: (typeof COLS)[number]) => {
    const now = c.get(row);
    const prior = before?.get(row.promotion);
    if (!prior) return String(now);
    const d = now - c.get(prior);
    return d > 0 ? `${now} +${d}` : d < 0 ? `${now} ${d}` : String(now);
  };
  const rendered = rows.map((r) => COLS.map((c) => cell(r, c)));
  const widths = COLS.map((c, i) => Math.max(c.head.length, ...rendered.map((x) => x[i].length)) + 2);
  const nameW = Math.max(10, ...rows.map((r) => r.promotion.length)) + 2;

  console.log(`\n── ${title} ${"─".repeat(Math.max(0, 60 - title.length))}`);
  console.log("  " + "promotion".padEnd(nameW) + COLS.map((c, i) => c.head.padStart(widths[i])).join(""));
  console.log("  " + "─".repeat(nameW + widths.reduce((n, w) => n + w, 0)));
  rows.forEach((r, i) => {
    console.log(`  ${r.promotion.padEnd(nameW)}${rendered[i].map((s, j) => s.padStart(widths[j])).join("")}`);
  });
}

// ── run ─────────────────────────────────────────────────────────────────────
const [conn] = await prisma.$queryRaw<{ db: string }[]>`SELECT current_database() AS db`;
console.log(`database : ${conn.db}`);
console.log(`leagues  : ${leagues.map((l) => l.key).join(", ")}`);
console.log(`years    : ${years[years.length - 1]}–${years[0]}${dryRun ? "   DRY RUN" : ""}`);

const before = await snapshot();
table("BEFORE (past events by promotion)", before);

console.log("\n── harvesting ──────────────────────────────────────────────────");
const { events, report } = await syncEspn({ leagues, years, onProgress: (l) => console.log(l) });

console.log("\n── source coverage ─────────────────────────────────────────────");
console.log(`  requests (one per league-year) : ${report.requests}`);
console.log(`  cards listed by ESPN           : ${report.eventsSeen}`);
console.log(`  bouts listed                   : ${report.boutsSeen}`);
console.log(`  bouts with a winner marked     : ${report.boutsDecided}`);
console.log(`  cards usable (>=1 bout)        : ${events.length}`);
if (report.emptyCards.length) {
  console.log(`\n  ${report.emptyCards.length} card(s) ESPN lists with NO bouts — the documented reason those stay empty:`);
  for (const c of report.emptyCards.slice(0, 12)) console.log(`      ${c.date}  ${c.league.padEnd(10)} ${c.name}`);
  if (report.emptyCards.length > 12) console.log(`      … and ${report.emptyCards.length - 12} more`);
}
if (report.warnings.length) {
  console.log(`\n  ⚠ ${report.warnings.length} fetch warning(s):`);
  for (const w of report.warnings.slice(0, 10)) console.log(`      ${w}`);
}

if (dryRun) {
  console.log("\n── would write (first 25) ──────────────────────────────────────");
  for (const ev of events.slice(0, 25)) {
    const dec = (ev.fights ?? []).filter((f) => f.result !== "SCHEDULED").length;
    console.log(`  ${ev.date.slice(0, 10)}  ${String(ev.fights?.length ?? 0).padStart(3)} bouts (${dec} decided)  ${ev.name}`);
  }
  await prisma.$disconnect();
  process.exit(0);
}

console.log("\n── writing ─────────────────────────────────────────────────────");
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
  console.log(`  ${sport.padEnd(12)} ${String(n).padStart(4)}/${String(list.length).padStart(4)} events persisted`);
}

const after = await snapshot();
table("AFTER (delta vs before)", after, before);

const sum = (m: Map<string, Row>, pick: (r: Row) => number) => [...m.values()].reduce((n, r) => n + pick(r), 0);
console.log("\n── net ─────────────────────────────────────────────────────────");
console.log(`  past events  +${sum(after, (r) => r.events) - sum(before, (r) => r.events)}`);
console.log(`  bouts        +${sum(after, (r) => r.bouts) - sum(before, (r) => r.bouts)}`);
console.log(`  decided      +${sum(after, (r) => r.decided) - sum(before, (r) => r.decided)}`);
console.log(`  empty cards  ${sum(before, (r) => r.empty)} → ${sum(after, (r) => r.empty)}`);
console.log(`  (${written} event upserts reported by the persistence layer)`);

if (events.length > 0 && written === 0) {
  console.log("\n  ✗ HARVEST OK, WRITES FAILED — see the warn-level log from persistAggregated.");
  console.log("    If it names a missing column: npx prisma db push");
}

await prisma.$disconnect();
