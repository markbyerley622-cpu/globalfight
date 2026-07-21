// ════════════════════════════════════════════════════════════════════════════
//  Development Seed World — entry point.
//
//    npm run seed:demo        wipe the demo world, then regenerate it
//    npm run seed:demo wipe   only wipe the demo world
//
//  Generates a believable combat-sports community (personas, behavioural picks,
//  threaded discussion, cards, reputation, notifications, activity, analytics) so
//  the product can be evaluated as it would feel after months of organic growth —
//  BEFORE acquiring a single real user. Dev/staging/demo only; see guard.mts.
// ════════════════════════════════════════════════════════════════════════════
import { assertSeedAllowed } from "./guard.mts";
import { generateWorld } from "./world.mts";
import { wipeWorld } from "./wipe.mts";
import { prisma } from "../../src/lib/db.ts";

async function main() {
  const t0 = Date.now();
  const ctx = assertSeedAllowed();
  const mode = process.argv[2] === "wipe" ? "wipe" : "regenerate";
  console.log(`\n🌍 Seed World — ${mode}  ·  db=${ctx.database}@${ctx.host}\n`);

  console.log("🧹 wiping existing demo data…");
  const wiped = await wipeWorld();
  console.log(`   removed ${wiped.users} demo users (+${wiped.analyticsEvents} analytics), repaired ${wiped.threadsRepaired} threads`);

  if (mode === "wipe") {
    console.log("\n✅ demo world cleared.\n");
    return;
  }

  console.log("👥 generating the community…");
  const summary = await generateWorld();

  const secs = ((Date.now() - t0) / 1000).toFixed(1);
  console.log("\n✅ Seed World ready:");
  for (const [k, v] of Object.entries(summary)) console.log(`   ${k.padEnd(18)} ${v}`);
  console.log(`\n   done in ${secs}s · sign in as any @seed.local user with password "demo-passw0rd"\n`);

  if (!summary.events) {
    console.log("⚠️  No events found in this database — picks & discussion need events.");
    console.log("    Run the ingest first (e.g. the refresh-events / sync cron) so the world has cards to predict.\n");
  }
}

main()
  .catch((e) => {
    console.error("\n" + (e instanceof Error ? e.message : String(e)) + "\n");
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
