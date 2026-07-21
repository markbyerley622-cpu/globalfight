// ════════════════════════════════════════════════════════════════════════════
//  Development Seed World — manual entry point.
//
//    npm run seed:demo       wipe the demo world, then regenerate it
//    npm run seed:refresh    alias of the above (explicit wipe + regenerate)
//    npm run seed:wipe       only wipe the demo world
//
//  Host-safe: runs only against a LOCAL database or an explicitly allowlisted
//  demo host (see guard.mts). Dev/staging/demo only — never production.
// ════════════════════════════════════════════════════════════════════════════
import { assertManualSeedAllowed, seedBanner } from "./guard.mts";
import { generateWorld } from "./world.mts";
import { wipeWorld } from "./wipe.mts";
import { writeMarker, deployId } from "./marker.mts";
import { prisma } from "../../src/lib/db.ts";

async function main() {
  const t0 = Date.now();
  const arg = process.argv[2];
  const mode = arg === "wipe" ? "wipe" : "regenerate"; // "refresh" falls through to regenerate
  const ctx = assertManualSeedAllowed();
  console.log("\n" + seedBanner(ctx) + "\n");

  console.log("🧹 wiping existing demo data…");
  const wiped = await wipeWorld();
  console.log(`   removed ${wiped.users} demo users (+${wiped.analyticsEvents} analytics), repaired ${wiped.threadsRepaired} threads`);

  if (mode === "wipe") {
    console.log("\n✅ demo world cleared.\n");
    return;
  }

  console.log("👥 generating the community…");
  const summary = await generateWorld();
  writeMarker({ deploy: deployId(), generatedAt: new Date().toISOString(), mode: "manual" });

  const secs = ((Date.now() - t0) / 1000).toFixed(1);
  console.log("\n✅ Seed World ready:");
  for (const [k, v] of Object.entries(summary)) console.log(`   ${k.padEnd(18)} ${v}`);
  console.log(`\n   done in ${secs}s · sign in as any @seed.local user with password "demo-passw0rd"\n`);

  if (!summary.events) {
    console.log("⚠️  No events found — picks & discussion need events. Run the ingest (refresh-events / sync) first.\n");
  }
}

main()
  .catch((e) => {
    console.error("\n" + (e instanceof Error ? e.message : String(e)) + "\n");
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
