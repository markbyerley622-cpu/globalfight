// Export the fighter-photo worklist for background removal.
//   node --import tsx scripts/photos-export.mts
//
// Sources, in order: a scraped promotion headshot (imageUrl), else the licensed
// Wikimedia photo the enrichment found (photoUrl — CC0 / CC BY-SA). Wikimedia
// photoUrl/photoCredit/photoLicense are LEFT INTACT on the row, so the profile
// keeps rendering attribution for the BY-SA ones; we only derive an extra
// black-background crop for the avatar.
import { prisma } from "../src/lib/db.ts";
import { writeFileSync, mkdirSync } from "node:fs";

// NOTE: the two arms must be split. A bare `NOT: { imageUrl: { startsWith } }`
// is SQL `NOT (imageUrl LIKE …)`, which evaluates to NULL — not TRUE — when
// imageUrl IS NULL, silently excluding every Wikimedia-only fighter.
const rows = await prisma.fighter.findMany({
  where: {
    OR: [
      // Wikimedia photo, no processed headshot yet.
      { imageUrl: null, photoUrl: { not: null } },
      // A raw (unprocessed) source headshot.
      { AND: [{ imageUrl: { not: null } }, { NOT: { imageUrl: { startsWith: "/headshots/" } } }] },
    ],
  },
  select: { slug: true, imageUrl: true, photoUrl: true },
});

const work = rows
  .map((r) => ({ slug: r.slug, imageUrl: r.imageUrl ?? r.photoUrl }))
  .filter((r): r is { slug: string; imageUrl: string } => !!r.imageUrl);

mkdirSync("scripts/.photowork", { recursive: true });
writeFileSync("scripts/.photowork/worklist.json", JSON.stringify(work));
console.log("worklist written:", work.length, "fighters");
await prisma.$disconnect();
