// Measured image coverage. Read-only, no network.
//
//   npm run images:coverage
//
// Splits "has no image" into causes that are NOT the same problem:
//   no candidate  — no provider knows this fighter (no ESPN id)
//   missing (404) — a provider published a URL that does not resolve
//   not tried     — due, never attempted
import { prisma } from "../src/lib/db.ts";
import { MEDIA_PROVIDERS, TIERS } from "../src/lib/media/index.ts";

const [conn] = await prisma.$queryRaw<{ db: string }[]>`SELECT current_database() AS db`;
console.log(`database : ${conn.db}`);
console.log(`providers: ${MEDIA_PROVIDERS.map((p) => `${p.key}(${p.tier})`).join(", ") || "none"}`);

const [total, withImage, missing, withEspnId, wikimedia] = await Promise.all([
  prisma.fighter.count(),
  prisma.fighter.count({ where: { imageUrl: { not: null } } }),
  prisma.fighter.count({ where: { imageMissingAt: { not: null } } }),
  prisma.fighter.count({ where: { externalIds: { some: { source: "espn" } } } }),
  prisma.fighter.count({ where: { photoUrl: { not: null } } }),
]);

const byTier = await prisma.$queryRaw<{ tier: string | null; n: bigint }[]>`
  SELECT "imageTier" AS tier, COUNT(*) AS n
  FROM "Fighter" WHERE "imageUrl" IS NOT NULL GROUP BY 1
`;
const tierCount = new Map(byTier.map((r) => [r.tier ?? "(untagged)", Number(r.n)]));

// Never tried: due, has a provider that could serve it, no image and no miss.
const notTried = await prisma.fighter.count({
  where: {
    imageUrl: null, imageMissingAt: null,
    externalIds: { some: { source: "espn" } },
  },
});
const noCandidate = await prisma.fighter.count({
  where: { imageUrl: null, externalIds: { none: { source: "espn" } } },
});

const pct = (n: number) => (total === 0 ? "—" : `${((n / total) * 100).toFixed(1)}%`);

console.log("\n══ FIGHTER IMAGE COVERAGE ═══════════════════════════════════════");
console.log(`  fighters                 : ${total}`);
console.log(`  with a stored image      : ${withImage}   ${pct(withImage)}`);
console.log(`  without                  : ${total - withImage}   ${pct(total - withImage)}`);

console.log("\n  by tier (best first — a lower tier never overwrites a higher one):");
for (const t of TIERS) console.log(`    ${t.padEnd(12)} ${String(tierCount.get(t) ?? 0).padStart(6)}`);
const untagged = tierCount.get("(untagged)") ?? 0;
if (untagged) console.log(`    ${"(untagged)".padEnd(12)} ${String(untagged).padStart(6)}   pre-dates this pipeline`);

console.log("\n  why the rest have none — different causes, never merged:");
console.log(`    no candidate  ${String(noCandidate).padStart(6)}   no provider knows them (no ESPN id)`);
console.log(`    missing 404   ${String(missing).padStart(6)}   provider URL does not resolve; retried monthly`);
console.log(`    not tried     ${String(notTried).padStart(6)}   due, never attempted — run images:sync`);

console.log("\n  related, separate paths:");
console.log(`    wikimedia photoUrl (licensed hotlink w/ attribution) : ${wikimedia}`);
console.log(`    fighters reachable by a provider (ESPN id)           : ${withEspnId}`);

// ── events / promotions ─────────────────────────────────────────────────────
const [events, eventsWithImage] = await Promise.all([
  prisma.event.count(),
  prisma.event.count({ where: { OR: [{ posterUrl: { not: null } }, { heroUrl: { not: null } }] } }),
]);
console.log("\n══ EVENT IMAGE COVERAGE ═════════════════════════════════════════");
console.log(`  events                   : ${events}`);
console.log(`  with a poster or hero    : ${eventsWithImage}`);
console.log(`  without                  : ${events - eventsWithImage}`);
console.log("  NO PROVIDER: ESPN's scoreboard carries no event artwork (verified), and no");
console.log("  promotion source has been licensed for posters. This is a source gap, not a");
console.log("  parser gap — nothing is fabricated to close it.");

await prisma.$disconnect();
