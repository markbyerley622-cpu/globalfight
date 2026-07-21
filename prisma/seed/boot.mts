// ════════════════════════════════════════════════════════════════════════════
//  Seed World — STARTUP runner.
//
//  Wired into the web service's start command, BEFORE `next start`:
//     node --import tsx prisma/seed/boot.mts ; npm start
//
//  It is NON-FATAL: any problem (unreachable DB, error) is logged and it exits 0,
//  so the app always starts. Driven solely by SEED_WORLD_MODE:
//    • off      → do nothing (existing seed data, if any, is left alone).
//    • demo     → seed once if the DB has no seed users; else skip (idempotent).
//    • refresh  → wipe + regenerate once per deploy, then behave as demo.
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
    `[seed] ${s.users} personas · ${s.openPicks + s.gradedPicks} predictions · ${s.posts} comments · ${s.cards} cards`,
  );
  console.log(`[seed] completed in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  writeMarker({ deploy: deployId(), generatedAt: new Date().toISOString(), mode });
}

async function main() {
  const ctx = resolveSeedWorld();
  console.log("\n" + seedBanner(ctx) + "\n");
  if (!ctx.enabled) return; // off — leave any existing seed data untouched

  if (ctx.mode === "refresh") {
    const marker = readMarker();
    if (marker?.deploy === deployId()) {
      console.log("[seed] refresh already applied for this deploy — skipping (behaving as demo).");
      return;
    }
    console.log("[seed] refresh — wiping demo data…");
    const w = await wipeWorld();
    console.log(`[seed] wiped ${w.users} demo users`);
    await generate("refresh");
    return;
  }

  // demo
  const existing = await seedUserCount();
  if (existing > 0) {
    console.log(`[seed] already populated (${existing} demo users) — skipping.`);
    return;
  }
  console.log("[seed] empty — populating the demo community");
  await generate("demo");
}

main()
  .catch((e) => {
    // NON-FATAL: never block the app from starting.
    console.error("[seed] error (non-fatal, app will start):", e instanceof Error ? e.message : String(e));
  })
  .finally(() => prisma.$disconnect());
