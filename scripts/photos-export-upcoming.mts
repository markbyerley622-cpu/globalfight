// Worklist of fighters on UPCOMING events (what the schedule shows) that still
// need a black-bg headshot. Prioritized before the full backfill.
import { prisma } from "../src/lib/db.ts";
import { writeFileSync, mkdirSync } from "node:fs";

const now = new Date();
const evs = await prisma.event.findMany({
  where: { date: { gte: now } },
  select: { fights: { select: { redId: true, blueId: true } } },
});
const ids = new Set<string>();
for (const e of evs) for (const f of e.fights) { ids.add(f.redId); ids.add(f.blueId); }
const rows = await prisma.fighter.findMany({
  where: { id: { in: [...ids] }, imageUrl: { not: null }, NOT: { imageUrl: { startsWith: "/headshots/" } } },
  select: { slug: true, imageUrl: true },
});
mkdirSync("scripts/.photowork", { recursive: true });
writeFileSync("scripts/.photowork/worklist.json", JSON.stringify(rows));
console.log("upcoming-event fighters to process:", rows.length);
await prisma.$disconnect();
