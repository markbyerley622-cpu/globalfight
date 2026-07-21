// npm run seed:status — report the Seed World's mode + populated counts.
// Read-only and never throws for mode=off; surfaces a gate error rather than crash.
import { resolveSeedWorld, seedBanner, type SeedWorldContext } from "./guard.mts";
import { readMarker } from "./marker.mts";
import { SEED_EMAIL_DOMAIN } from "./world.mts";
import { prisma } from "../../src/lib/db.ts";

async function main() {
  let ctx: SeedWorldContext | null = null;
  try {
    ctx = resolveSeedWorld();
    console.log("\n" + seedBanner(ctx) + "\n");
  } catch (e) {
    console.log(`\nMode: ${process.env.SEED_WORLD_MODE ?? "off"}`);
    console.log("Gate: " + (e instanceof Error ? e.message : String(e)) + "\n");
  }

  const seedUsers = await prisma.user.findMany({ where: { email: { endsWith: SEED_EMAIL_DOMAIN } }, select: { id: true } });
  const ids = seedUsers.map((u) => u.id);
  if (!ids.length) {
    console.log("Personas: 0 (demo world not populated)\n");
    return;
  }

  const [predictions, comments, cards, notifications, activities, reactions] = await Promise.all([
    prisma.fightPick.count({ where: { userId: { in: ids } } }),
    prisma.forumPost.count({ where: { authorId: { in: ids } } }),
    prisma.cardAward.count({ where: { userId: { in: ids } } }),
    prisma.notification.count({ where: { userId: { in: ids } } }),
    prisma.activity.count({ where: { userId: { in: ids } } }),
    prisma.forumReaction.count({ where: { userId: { in: ids } } }),
  ]);
  const marker = readMarker();

  console.log("Seed World status");
  console.log(`  mode            ${ctx?.mode ?? process.env.SEED_WORLD_MODE ?? "off"}`);
  console.log(`  enabled         ${ctx?.enabled ?? false}`);
  console.log(`  personas        ${seedUsers.length}`);
  console.log(`  predictions     ${predictions}`);
  console.log(`  comments        ${comments}`);
  console.log(`  reactions       ${reactions}`);
  console.log(`  cards           ${cards}`);
  console.log(`  notifications   ${notifications}`);
  console.log(`  activities      ${activities}`);
  console.log(`  last generated  ${marker?.generatedAt ?? "unknown"}`);
  console.log("");
}

main()
  .catch((e) => {
    console.error(e instanceof Error ? e.message : String(e));
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
