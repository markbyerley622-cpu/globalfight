// Remove obsolete local TEST events — the ones that have made "events without
// bouts" read as 5 for weeks.
//
//   npm run events:prune-test            # report only
//   npm run events:prune-test -- --apply
//
// Refuses to touch anything that looks real. An event qualifies ONLY if it has
// no bouts, is in the past, and either matches a known test-fixture name or has
// no provenance at all (no EventExternalId — nothing ingested it, so a human or
// a test made it). Anything a provider wrote is left alone, whatever it is called.
import { prisma } from "../src/lib/db.ts";

const apply = process.argv.includes("--apply");
const TEST_NAME = /^page test event|^test event|^example event/i;

const empty = await prisma.event.findMany({
  where: { date: { lt: new Date() }, fights: { none: {} } },
  select: {
    id: true, name: true, slug: true, date: true, promotion: true,
    externalIds: { select: { source: true } },
    _count: { select: { followers: true, checkIns: true } },
  },
  orderBy: { date: "desc" },
});

console.log(`past events with no bouts: ${empty.length}\n`);

const doomed: typeof empty = [];
for (const e of empty) {
  const nameLooksTest = TEST_NAME.test(e.name);
  const noProvenance = e.externalIds.length === 0;
  const engaged = e._count.followers > 0 || e._count.checkIns > 0;
  const verdict = engaged
    ? "KEEP — users have engaged with it"
    : nameLooksTest
      ? "DELETE — test-fixture name"
      : noProvenance
        ? "DELETE — no provenance; nothing ingested this"
        : `KEEP — ingested by ${e.externalIds.map((x) => x.source).join(", ")}`;
  console.log(`  ${e.date.toISOString().slice(0, 10)}  ${e.name.padEnd(34)} ${verdict}`);
  if (verdict.startsWith("DELETE")) doomed.push(e);
}

console.log(`\nto delete: ${doomed.length}   to keep: ${empty.length - doomed.length}`);

if (!apply) {
  console.log("\nDRY RUN — pass --apply to delete.");
} else if (doomed.length) {
  const ids = doomed.map((e) => e.id);
  // Children first; Event has no cascade for these.
  await prisma.eventExternalId.deleteMany({ where: { eventId: { in: ids } } });
  await prisma.favoriteEvent.deleteMany({ where: { eventId: { in: ids } } }).catch(() => undefined);
  await prisma.checkIn.deleteMany({ where: { eventId: { in: ids } } }).catch(() => undefined);
  await prisma.forumThread.deleteMany({ where: { eventId: { in: ids } } }).catch(() => undefined);
  const res = await prisma.event.deleteMany({ where: { id: { in: ids } } });
  console.log(`\ndeleted ${res.count} event(s).`);

  const left = await prisma.event.count({ where: { date: { lt: new Date() }, fights: { none: {} } } });
  console.log(`past events with no bouts now: ${left}`);
}

await prisma.$disconnect();
