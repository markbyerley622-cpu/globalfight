// FORWARD schedule coverage — the metric the product actually runs on.
//
//   npm run audit:schedule
//
// Historical coverage makes an archive. FORWARD coverage is what predictions,
// reminders, notifications, follows and every retention loop consume: you cannot
// pick a fight that has already happened. The integrity audit measures whether
// what we hold is correct; this measures whether there is anything to DO.
//
// "Real matchups" is the number that matters most. A card with two TBA corners
// is not something anyone can predict on, so it is counted separately rather
// than inflating the headline.
import { prisma } from "../src/lib/db.ts";
import { isRealBout } from "../src/lib/entities/placeholder.ts";

const now = new Date();
const days = (n: number) => new Date(now.getTime() + n * 86_400_000);

const UPCOMING = {
  date: { gte: now },
  status: { notIn: ["COMPLETED", "CANCELLED", "DRAFT"] as never },
};

async function main() {
  console.log("\n  FORWARD SCHEDULE COVERAGE\n");

  const sports = (await prisma.event.groupBy({ by: ["sport"], _count: { _all: true } }))
    .map((s) => s.sport)
    .sort();

  console.log("  sport           events  bouts  real  titles   7d  30d  90d   lead(d)");
  console.log("  ─────────────────────────────────────────────────────────────────────");

  let tE = 0, tB = 0, tR = 0, tT = 0;
  for (const sport of sports) {
    const evWhere = { sport, ...UPCOMING };
    const [events, fights, d7, d30, d90, furthest] = await Promise.all([
      prisma.event.count({ where: evWhere }),
      prisma.fight.findMany({
        where: { result: "SCHEDULED", cancelled: false, event: evWhere },
        select: { titleFight: true, red: { select: { name: true } }, blue: { select: { name: true } } },
      }),
      prisma.event.count({ where: { ...evWhere, date: { gte: now, lte: days(7) } } }),
      prisma.event.count({ where: { ...evWhere, date: { gte: now, lte: days(30) } } }),
      prisma.event.count({ where: { ...evWhere, date: { gte: now, lte: days(90) } } }),
      prisma.event.findFirst({ where: evWhere, orderBy: { date: "desc" }, select: { date: true } }),
    ]);
    if (events === 0) continue;

    const real = fights.filter((f) => isRealBout(f.red.name, f.blue.name)).length;
    const titles = fights.filter((f) => f.titleFight).length;
    const lead = furthest ? Math.round((+furthest.date - +now) / 86_400_000) : 0;

    tE += events; tB += fights.length; tR += real; tT += titles;
    console.log(
      `  ${sport.replace(/_/g, " ").padEnd(14)}` +
        `${String(events).padStart(6)} ${String(fights.length).padStart(6)} ${String(real).padStart(5)} ` +
        `${String(titles).padStart(6)} ${String(d7).padStart(4)} ${String(d30).padStart(4)} ${String(d90).padStart(4)} ` +
        `${String(lead).padStart(8)}`,
    );
  }
  console.log("  ─────────────────────────────────────────────────────────────────────");
  console.log(`  ${"TOTAL".padEnd(14)}${String(tE).padStart(6)} ${String(tB).padStart(6)} ${String(tR).padStart(5)} ${String(tT).padStart(6)}`);

  // Which provider is supplying the forward schedule? A sport with events but no
  // provider behind them is one nobody is maintaining.
  const upcoming = await prisma.event.findMany({
    where: UPCOMING,
    select: { sport: true, externalIds: { select: { source: true } } },
  });
  const bySource = new Map<string, number>();
  for (const e of upcoming) {
    const key = e.externalIds.map((x) => x.source).sort().join(",") || "(no provenance)";
    bySource.set(key, (bySource.get(key) ?? 0) + 1);
  }
  console.log("\n  Upcoming events by provider:");
  for (const [k, v] of [...bySource].sort((a, b) => b[1] - a[1])) {
    console.log(`      ${String(v).padStart(4)}  ${k}`);
  }

  // Predictable NOW: the retention loop's real denominator.
  const predictable = await prisma.fight.count({
    where: { result: "SCHEDULED", cancelled: false, event: { ...UPCOMING, date: { lte: days(30) } } },
  });
  console.log(`\n  Bouts predictable in the next 30 days: ${predictable}`);
  console.log("");
}

try {
  await main();
} finally {
  await prisma.$disconnect();
}
