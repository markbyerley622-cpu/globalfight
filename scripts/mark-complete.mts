// Recompute Event.resultsCompleteAt across the whole table.
//
//   npm run cards:mark-complete            # report what would change
//   npm run cards:mark-complete -- --apply # write it
//
// persist.ts maintains this flag per event as cards land, so this exists for the
// two cases that bypass that path: the first run after the column was added, and
// any bulk import or manual edit that changed results without going through
// persistAggregated.
//
// A card is COMPLETE when it is in the past, has at least one bout, and not one
// of them is still SCHEDULED. The results cron skips completed cards — that is
// what stops the hourly job re-reading all of history.
import { prisma } from "../src/lib/db.ts";
import { STATIC_IMPORT_SOURCES } from "../src/lib/scraper/source-policy.ts";

const apply = process.argv.includes("--apply");
const now = new Date();

const [conn] = await prisma.$queryRaw<{ db: string }[]>`SELECT current_database() AS db`;
console.log(`database : ${conn.db}${apply ? "" : "   DRY RUN — pass --apply to write"}`);

// One pass over past events with their bout tallies.
const rows = await prisma.$queryRaw<
  { id: string; name: string; complete: boolean; flagged: boolean }[]
>`
  SELECT e.id,
         e.name,
         (COUNT(f.id) > 0 AND COUNT(f.id) FILTER (WHERE f.result = 'SCHEDULED') = 0) AS complete,
         (e."resultsCompleteAt" IS NOT NULL)                                          AS flagged
  FROM "Event" e
  LEFT JOIN "Fight" f ON f."eventId" = e.id
  WHERE e.date < ${now}
  GROUP BY e.id, e.name, e."resultsCompleteAt"
`;

const toSet = rows.filter((r) => r.complete && !r.flagged);
const toClear = rows.filter((r) => !r.complete && r.flagged);

console.log(`\npast events        : ${rows.length}`);
console.log(`already correct    : ${rows.length - toSet.length - toClear.length}`);
console.log(`to mark complete   : ${toSet.length}`);
console.log(`to clear           : ${toClear.length}`);

for (const r of toSet.slice(0, 10)) console.log(`   + ${r.name}`);
if (toSet.length > 10) console.log(`   … and ${toSet.length - 10} more`);
for (const r of toClear.slice(0, 10)) console.log(`   - ${r.name}`);

if (apply) {
  if (toSet.length) {
    await prisma.event.updateMany({
      where: { id: { in: toSet.map((r) => r.id) } },
      data: { resultsCompleteAt: now },
    });
  }
  if (toClear.length) {
    await prisma.event.updateMany({
      where: { id: { in: toClear.map((r) => r.id) } },
      data: { resultsCompleteAt: null },
    });
  }
  // ── TERMINAL: past, undecided bouts, only one-shot sources ────────────────
  // Not complete and not incomplete. Recorded so a bracket sport with walkover
  // bouts stops being reported as a promotion that is behind on results.
  const terminal = await prisma.$queryRaw<{ id: string; sources: string; pending: bigint; total: bigint }[]>`
    SELECT e.id,
           string_agg(DISTINCT x.source, ', ')                       AS sources,
           COUNT(f.id) FILTER (WHERE f.result = 'SCHEDULED')          AS pending,
           COUNT(f.id)                                                AS total
    FROM "Event" e
    JOIN "EventExternalId" x ON x."eventId" = e.id
    JOIN "Fight" f ON f."eventId" = e.id
    WHERE e.date < ${now} AND e."resultsCompleteAt" IS NULL
    GROUP BY e.id
    HAVING COUNT(f.id) FILTER (WHERE f.result = 'SCHEDULED') > 0
       AND bool_and(x.source = ANY(${STATIC_IMPORT_SOURCES}))
  `;
  for (const t of terminal) {
    await prisma.event.update({
      where: { id: t.id },
      data: {
        resultsTerminalReason: `static source (${t.sources}) published no outcome for ${Number(t.pending)} of ${Number(t.total)} bouts`,
      },
    });
  }
  // And clear the reason anywhere it no longer holds.
  await prisma.event.updateMany({
    where: { resultsCompleteAt: { not: null }, resultsTerminalReason: { not: null } },
    data: { resultsTerminalReason: null },
  });

  const flagged = await prisma.event.count({ where: { resultsCompleteAt: { not: null } } });
  const term = await prisma.event.count({ where: { resultsTerminalReason: { not: null } } });
  console.log(`\napplied.`);
  console.log(`  COMPLETE : ${flagged}   (every bout decided — skipped by every cron tier)`);
  console.log(`  TERMINAL : ${term}   (static source, gaps the source itself has — never queueable)`);
  console.log(`  the rest remain INCOMPLETE and queueable.`);
}

await prisma.$disconnect();
