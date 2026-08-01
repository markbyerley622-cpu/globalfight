// Clear `city` where it is a copy of `venue`.
//
//   npm run repair:venue-city            # report
//   npm run repair:venue-city -- --apply
//
// BKFC's JSON-LD `location.name` is often just the building ("OVO HYDRO"), and
// splitLocation returned a single-part input as the city — so the venue name
// landed in the city field on 142 of 168 events. The parser is fixed
// (bkfc/normalize.ts); this clears what it already wrote.
//
// Only touches rows where city === venue EXACTLY. A real city that happens to
// share a name with its venue is not something this can distinguish, but the
// pairing is what the bug produced and a genuine "Tokyo / Tokyo Dome" differs.
import { prisma } from "../src/lib/db.ts";

const apply = process.argv.includes("--apply");
const [conn] = await prisma.$queryRaw<{ db: string }[]>`SELECT current_database() AS db`;
console.log(`database : ${conn.db}${apply ? "" : "   DRY RUN — pass --apply to write"}`);

const bad = await prisma.$queryRaw<{ id: string; name: string; venue: string; promotion: string | null }[]>`
  SELECT id, name, venue, promotion FROM "Event"
  WHERE venue IS NOT NULL AND city IS NOT NULL AND btrim(lower(city)) = btrim(lower(venue))
  ORDER BY promotion, name
`;

console.log(`\nevents whose city is a copy of the venue: ${bad.length}`);
const byPromo = new Map<string, number>();
for (const b of bad) byPromo.set(b.promotion ?? "—", (byPromo.get(b.promotion ?? "—") ?? 0) + 1);
for (const [p, n] of [...byPromo].sort((a, b) => b[1] - a[1])) console.log(`  ${String(n).padStart(4)}  ${p}`);
for (const b of bad.slice(0, 6)) console.log(`      "${b.venue}"  ← ${b.name.slice(0, 50)}`);

if (apply && bad.length) {
  // Venue is kept — it is correct. Only the city claim is withdrawn.
  const res = await prisma.event.updateMany({
    where: { id: { in: bad.map((b) => b.id) } },
    data: { city: null },
  });
  console.log(`\ncleared city on ${res.count} event(s). Venue left intact.`);
  const left = await prisma.$queryRaw<{ n: bigint }[]>`
    SELECT COUNT(*) AS n FROM "Event"
    WHERE venue IS NOT NULL AND city IS NOT NULL AND btrim(lower(city)) = btrim(lower(venue))`;
  console.log(`remaining: ${Number(left[0].n)}`);
} else if (!apply) {
  console.log("\nDRY RUN — nothing written.");
}

await prisma.$disconnect();
