// Upload the locally generated black-bg headshots (public/headshots — gitignored,
// so NOT deployed) to cloud storage, and repoint each fighter at the CDN URLs.
//
//   STORAGE_PROVIDER=r2 R2_BUCKET=... R2_ACCESS_KEY_ID=... R2_SECRET_ACCESS_KEY=... \
//   R2_ENDPOINT=... R2_PUBLIC_BASE_URL=... \
//   node --import tsx scripts/photos-upload.mts [limit]
//
// Reuses the existing image pipeline (processAndStoreBuffer → sharp variants →
// getStorage()), so the resulting URLs are "own storage" — which is exactly what
// next.config's remotePatterns and media-safe's OWN_HOSTS already allow. Local
// /headshots paths only work on a dev box; these URLs work anywhere.
import { readFileSync, existsSync } from "node:fs";
import { prisma } from "../src/lib/db.ts";
import { processAndStoreBuffer } from "../src/lib/images/store.ts";
import { getStorage } from "../src/lib/storage.ts";

const limit = Number(process.argv[2] ?? 0);

const provider = getStorage();
if (provider.name === "url") {
  console.error(
    "STORAGE_PROVIDER is unset (defaults to 'url' = no binary uploads).\n" +
      "Set STORAGE_PROVIDER=r2 (or s3) plus R2_BUCKET / R2_ACCESS_KEY_ID /\n" +
      "R2_SECRET_ACCESS_KEY / R2_ENDPOINT / R2_PUBLIC_BASE_URL, then re-run.",
  );
  process.exit(1);
}
console.log("storage provider:", provider.name);

// Fighters whose photo is still a local-only /headshots path.
const rows = await prisma.fighter.findMany({
  where: { imageUrl: { startsWith: "/headshots/" } },
  select: { slug: true },
  ...(limit > 0 ? { take: limit } : {}),
});
console.log(`fighters to upload: ${rows.length}`);

let uploaded = 0;
let missing = 0;
let failed = 0;
for (const [i, f] of rows.entries()) {
  const path = `public/headshots/${f.slug}.png`;
  if (!existsSync(path)) {
    missing++;
    continue;
  }
  try {
    const stored = await processAndStoreBuffer(f.slug, readFileSync(path));
    await prisma.fighter.update({
      where: { slug: f.slug },
      data: { imageUrl: stored.imageUrl, thumbUrl: stored.thumbUrl, heroImageUrl: stored.heroImageUrl },
    });
    uploaded++;
  } catch (e) {
    failed++;
    console.log("fail", f.slug, (e as Error).message.slice(0, 80));
  }
  if ((i + 1) % 50 === 0) console.log(`${i + 1}/${rows.length} …`);
}

console.log(`uploaded=${uploaded} missing-file=${missing} failed=${failed}`);
await prisma.$disconnect();
