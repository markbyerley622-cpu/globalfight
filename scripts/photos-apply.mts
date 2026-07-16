// Point each processed fighter's imageUrl at the local black-bg PNG.
//   node --import tsx scripts/photos-apply.mts
import { prisma } from "../src/lib/db.ts";
import { readFileSync } from "node:fs";

const done = JSON.parse(readFileSync("scripts/.photowork/done.json", "utf8")) as string[];
let n = 0;
for (const slug of done) {
  try {
    await prisma.fighter.update({ where: { slug }, data: { imageUrl: `/headshots/${slug}.png` } });
    n++;
  } catch {
    /* fighter removed since export — ignore */
  }
}
console.log("updated imageUrl for", n, "fighters");
await prisma.$disconnect();
