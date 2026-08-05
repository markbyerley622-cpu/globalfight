// What would `isRenderableEvent` hide, and why — `npm run audit:renderable`.
//
// Read-only. Run it against production before assuming the filter is safe:
// the shapes that motivated the rule (sport-and-date shells) do not exist in
// every database, and a rule that quietly removes a whole promotion is worse
// than the empty card it was meant to fix.
import { prisma } from "@/lib/db";
import { eventSkipReason, SKIP_LABEL, type SkipReason } from "@/lib/events/renderable";

const rows = await prisma.event.findMany({
  select: {
    name: true, promotion: true, date: true, sport: true,
    _count: { select: { fights: true } },
  },
  orderBy: { date: "desc" },
});

const byReason = new Map<SkipReason, { name: string; promotion: string | null; date: Date }[]>();
let kept = 0;

for (const r of rows) {
  const reason = eventSkipReason({
    name: r.name,
    promotion: r.promotion ?? undefined,
    date: r.date.toISOString(),
    sport: r.sport as never,
    // Only the LENGTH is read, so a count stands in for the array and this
    // audit does not have to load every bout on every card.
    fights: Array.from({ length: r._count.fights }) as never,
  });
  if (!reason) { kept++; continue; }
  if (!byReason.has(reason)) byReason.set(reason, []);
  byReason.get(reason)!.push({ name: r.name, promotion: r.promotion, date: r.date });
}

const hidden = rows.length - kept;
console.log(`\n  ${rows.length} events · ${kept} renderable · ${hidden} hidden\n`);

for (const [reason, list] of [...byReason.entries()].sort((a, b) => b[1].length - a[1].length)) {
  console.log(`  ${reason} — ${SKIP_LABEL[reason]}`);
  console.log(`  ${list.length} event(s)`);
  const promos = new Map<string, number>();
  for (const e of list) promos.set(e.promotion ?? "(none)", (promos.get(e.promotion ?? "(none)") ?? 0) + 1);
  for (const [p, n] of [...promos.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5)) {
    console.log(`      ${n.toString().padStart(4)}  ${p}`);
  }
  for (const e of list.slice(0, 3)) {
    console.log(`      e.g. ${e.name} (${e.date.toISOString().slice(0, 10)})`);
  }
  console.log("");
}

// The check that matters: an announced upcoming card is NOT an empty card.
const upcomingNoBouts = rows.filter(
  (r) => r._count.fights === 0 && r.date.getTime() > Date.now(),
);
const stillShown = upcomingNoBouts.filter((r) => eventSkipReason({
  name: r.name, promotion: r.promotion ?? undefined, date: r.date.toISOString(),
  sport: r.sport as never, fights: [] as never,
}) === null);
console.log(`  Upcoming cards with no bouts yet: ${upcomingNoBouts.length}`);
console.log(`  ...of which still shown (bouts TBA, correct): ${stillShown.length}`);
if (stillShown.length !== upcomingNoBouts.length) {
  console.log(`  WARNING: ${upcomingNoBouts.length - stillShown.length} announced upcoming card(s) would be hidden.`);
}
console.log("");

await prisma.$disconnect();
