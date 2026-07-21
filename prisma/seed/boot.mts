// ════════════════════════════════════════════════════════════════════════════
//  Seed World — STARTUP runner.
//
//  Wired into the web service's start command, BEFORE `next start`:
//     node --import tsx prisma/seed/boot.mts ; npm start
//
//  It is NON-FATAL: any problem (unreachable DB, error) is logged and it exits 0,
//  so the app always starts. Driven by the ALLOW_SEED_WORLD master switch:
//
//    • ALLOW_SEED_WORLD != true  → PURGE every trace of demo data, every boot.
//      Not "stop seeding" — actively delete, so flipping the switch off is what
//      takes a demo database to a real one. Idempotent: with nothing to remove it
//      deletes nothing and says so.
//    • ALLOW_SEED_WORLD = true   → seeding permitted; SEED_WORLD_MODE picks how:
//        demo (default) → seed once if the DB has no seed users; else skip.
//        refresh        → wipe + regenerate once per deploy, then behave as demo.
// ════════════════════════════════════════════════════════════════════════════
import { resolveSeedWorld, seedBanner } from "./guard.mts";
import { generateWorld, SEED_EMAIL_DOMAIN } from "./world.mts";
import { wipeWorld } from "./wipe.mts";
import { readMarker, writeMarker, clearMarker, deployId } from "./marker.mts";
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

  // ── Not allowed ⇒ this database must contain NO demo data. ────────────────
  // Deleting rather than hiding is the whole point: a filtered fake account is
  // one missed WHERE clause from a real user, and launch is when that happens.
  if (!ctx.enabled) {
    const existing = await seedUserCount();
    if (existing === 0) {
      console.log("[seed] not allowed and none present — nothing to purge.");
      return;
    }
    console.log(`[seed] ALLOW_SEED_WORLD is not true but ${existing} demo users exist — purging.`);
    const w = await wipeWorld();
    console.log(`[seed] purged ${w.users} demo users (+${w.analyticsEvents} analytics, ${w.roomsRemoved} empty rooms, ${w.threadsRepaired} threads repaired)`);
    clearMarker();
    return;
  }

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
