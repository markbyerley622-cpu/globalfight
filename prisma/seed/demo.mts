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

const demoFlagOn = ["true", "1", "on", "yes"].includes((process.env.DEMO_MODE ?? "").toLowerCase());

async function main() {
  const t0 = Date.now();
  const arg = process.argv[2];
  // `sync` reads DEMO_MODE from the env: true → populate, false → clear. This is
  // the one-command on/off toggle (npm run demo). `wipe` clears; anything else
  // regenerates. Physical presence, not a query filter — off means the rows are
  // actually gone, so nothing can ever leak.
  const mode = arg === "wipe" ? "wipe" : arg === "sync" ? (demoFlagOn ? "regenerate" : "wipe") : "regenerate";
  const ctx = assertManualSeedAllowed();
  if (arg === "sync") console.log(`\nDEMO_MODE=${process.env.DEMO_MODE ?? "(unset)"} → ${demoFlagOn ? "ON (populate)" : "OFF (clear)"}`);
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
