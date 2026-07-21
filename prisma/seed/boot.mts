// ════════════════════════════════════════════════════════════════════════════
//  Seed World — STARTUP runner (demo service only).
//
//  Wired into the DEMO Render service's start command, BEFORE `next start`:
//     node --import tsx prisma/seed/boot.mts && npm start
//
//  The production service does NOT run this — its start command stays `npm start`
//  — so seed code never executes in production regardless of any env value.
//
//  Behaviour:
//    • mode=off      → print DISABLED banner, exit 0 (app starts normally).
//    • mode=demo     → seed once if the demo DB has no seed users; else skip.
//    • mode=refresh  → wipe + regenerate once per deploy, then behave as demo.
//    • misconfigured → resolveSeedWorld() throws → non-zero exit → the `&&` stops
//                      `next start`, so the service refuses to start LOUDLY.
// ════════════════════════════════════════════════════════════════════════════
import { resolveSeedWorld, seedBanner } from "./guard.mts";
import { generateWorld, SEED_EMAIL_DOMAIN } from "./world.mts";
import { wipeWorld } from "./wipe.mts";
import { readMarker, writeMarker, deployId } from "./marker.mts";
import { prisma } from "../../src/lib/db.ts";

async function seedUserCount(): Promise<number> {
  return prisma.user.count({ where: { email: { endsWith: SEED_EMAIL_DOMAIN } } });
}

async function generate(mode: string) {
  const t0 = Date.now();
  console.log("[seed] generating the demo community…");
  const s = await generateWorld();
  console.log(
    `[seed] generated ${s.users} personas · ${s.openPicks + s.gradedPicks} predictions · ` +
      `${s.posts} comments · ${s.cards} cards`,
  );
  console.log(`[seed] completed in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  writeMarker({ deploy: deployId(), generatedAt: new Date().toISOString(), mode });
}

async function main() {
  const ctx = resolveSeedWorld(); // throws on unsafe/contradictory config → refuse to start
  console.log("\n" + seedBanner(ctx) + "\n");

  if (!ctx.enabled) return; // mode=off — nothing to do, app starts normally

  if (ctx.mode === "refresh") {
    const marker = readMarker();
    if (marker?.deploy === deployId()) {
      console.log("[seed] refresh already applied for this deploy — skipping (behaving as demo).");
      return;
    }
    console.log("[seed] refresh requested — wiping demo data…");
    const w = await wipeWorld();
    console.log(`[seed] wiped ${w.users} demo users`);
    await generate("refresh");
    return;
  }

  // demo
  const existing = await seedUserCount();
  if (existing > 0) {
    console.log(`[seed] demo database already populated (${existing} demo users) — skipping.`);
    return;
  }
  console.log("[seed] detected empty demo database");
  await generate("demo");
}

main()
  .catch((e) => {
    console.error("\n" + (e instanceof Error ? e.message : String(e)) + "\n");
    process.exitCode = 1; // non-zero → `&&` halts `next start` → service refuses to start
  })
  .finally(() => prisma.$disconnect());
