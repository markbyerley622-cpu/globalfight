// Fighter images, from the media providers, into our own storage.
//
//   npm run images:sync                    # everything due
//   npm run images:sync -- --limit=200
//   npm run images:sync -- --force         # ignore the 30-day miss backoff
//   npm run images:sync -- --dry-run
//
// IDEMPOTENT. A second run transfers almost nothing: conditional GETs return 304,
// and anything that does come back is compared by content hash before it is
// processed or stored. Safe to interrupt — each fighter is written as it lands.
//
// Never overwrites a better image: manual > official > wikimedia > espn.
import { prisma } from "../src/lib/db.ts";
import { processAndStoreBuffer } from "../src/lib/images/store.ts";
import { syncMedia, MEDIA_PROVIDERS } from "../src/lib/media/index.ts";
import type { MediaSubject } from "../src/lib/media/types.ts";

const argv = process.argv.slice(2);
const flag = (n: string) => argv.includes(`--${n}`);
const num = (n: string, d: number) => {
  const v = argv.find((a) => a.startsWith(`--${n}=`));
  return v ? Number(v.slice(n.length + 3)) : d;
};

const limit = num("limit", 500);
const dryRun = flag("dry-run");
const force = flag("force");
const now = new Date();

const [conn] = await prisma.$queryRaw<{ db: string }[]>`SELECT current_database() AS db`;
console.log(`database : ${conn.db}`);
console.log(`providers: ${MEDIA_PROVIDERS.map((p) => `${p.key}(${p.tier})`).join(", ")}`);
console.log(`limit    : ${limit}${force ? "   FORCE (ignore backoff)" : ""}${dryRun ? "   DRY RUN" : ""}`);
if (flag("revalidate")) console.log("mode     : REVALIDATE — re-check held images with a conditional GET");

// ── who needs one ───────────────────────────────────────────────────────────
// Fighters with an ESPN id, ordered so the never-attempted come first and the
// previously-missing drift to the back — the same rotation idea the results
// queue uses, so nothing is starved and nothing is hammered.
// --revalidate is the WEEKLY refresh mode: re-check images we already hold,
// oldest first. It is the mode conditional GETs exist for — a full pass should
// transfer almost nothing and report 304s.
const revalidate = flag("revalidate");

const rows = await prisma.fighter.findMany({
  where: {
    externalIds: { some: { source: "espn" } },
    ...(revalidate ? { imageUrl: { not: null }, imageContentHash: { not: null } } : {}),
  },
  orderBy: [{ imageFetchedAt: { sort: "asc", nulls: "first" } }, { imageMissingAt: { sort: "asc", nulls: "first" } }],
  take: limit,
  select: {
    id: true, slug: true, name: true,
    imageTier: true, imageETag: true, imageLastModified: true, imageContentHash: true,
    imageMissingAt: true, imageUrl: true,
    externalIds: { where: { source: "espn" }, select: { source: true, externalId: true } },
  },
});

const before = await coverage();
console.log(`\ncandidates: ${rows.length} fighter(s) with an ESPN id`);

const subjects: (MediaSubject & { missingAt: Date | null })[] = rows.map((f) => ({
  id: f.id,
  slug: f.slug,
  name: f.name,
  externalIds: Object.fromEntries(f.externalIds.map((x) => [x.source, x.externalId])),
  held: {
    // An image row with no stored URL is not held, whatever the tier says.
    tier: f.imageUrl ? f.imageTier : null,
    etag: f.imageUrl ? f.imageETag : null,
    lastModified: f.imageUrl ? f.imageLastModified : null,
    contentHash: f.imageUrl ? f.imageContentHash : null,
  },
  missingAt: f.imageMissingAt,
}));

// ── durable per subject ─────────────────────────────────────────────────────
// Persisted the instant each fighter's outcome is known, NOT collected and
// committed at the end. A run killed at fighter 900 of 1,300 keeps all 900; the
// next run skips them via their stored ETag and transfers nothing for them.
let stored = 0;
let touched = 0;
let missed = 0;

async function persist(w: { subjectId: string; stored?: NonNullable<Awaited<ReturnType<typeof syncMedia>>["writes"][number]["stored"]>; touchedAt?: Date; missing?: { at: Date; reason: string } }) {
  if (w.stored) {
    // The EXISTING image store: sharp variants -> getStorage(). Nothing here
    // writes a remote URL into a rendered field; the source URL is provenance.
    const images = await processAndStoreBuffer(w.stored.slug, w.stored.buffer);
    await prisma.fighter.update({
      where: { id: w.subjectId },
      data: {
        thumbUrl: images.thumbUrl,
        imageUrl: images.imageUrl,
        heroImageUrl: images.heroImageUrl,
        imageTier: w.stored.tier,
        imageSource: w.stored.source,
        imageSourceUrl: w.stored.sourceUrl,
        imageETag: w.stored.etag,
        imageLastModified: w.stored.lastModified,
        imageContentHash: w.stored.contentHash,
        imageMimeType: w.stored.mimeType,
        imageFetchedAt: now,
        imageMissingAt: null,
        imageMissReason: null,
        imageAttempts: { increment: 1 },
      },
    });
    stored += 1;
  } else if (w.touchedAt) {
    // 304 or identical hash: what we hold is current. Record the check so the
    // rotation moves on.
    await prisma.fighter.update({
      where: { id: w.subjectId },
      data: { imageFetchedAt: w.touchedAt, imageAttempts: { increment: 1 } },
    });
    touched += 1;
  } else if (w.missing) {
    await prisma.fighter.update({
      where: { id: w.subjectId },
      data: { imageMissingAt: w.missing.at, imageMissReason: w.missing.reason, imageAttempts: { increment: 1 } },
    });
    missed += 1;
  }
}

console.log("\n── fetching + storing (durable per fighter) ────────────────────");
const { report } = await syncMedia({
  onSubjectDone: dryRun ? undefined : persist,
  subjects, providers: MEDIA_PROVIDERS, now, force,
  // Unhurried by default — this is someone else's CDN and a backfill is thousands
  // of requests. IMAGE_RATE_LIMIT_MS tunes it.
  delayMs: Number(process.env.IMAGE_RATE_LIMIT_MS ?? 250),
  onProgress: (l) => console.log(l),
});

console.log("\n── outcomes ────────────────────────────────────────────────────");
for (const [k, v] of Object.entries(report.byOutcome)) {
  if (v > 0) console.log(`  ${k.padEnd(18)} ${String(v).padStart(5)}`);
}
console.log(`  ${"bytes downloaded".padEnd(18)} ${(report.bytesDownloaded / 1024 / 1024).toFixed(2)} MB`);
if (report.failures.length) {
  console.log(`\n  ⚠ ${report.failures.length} failure(s):`);
  for (const f of report.failures.slice(0, 8)) console.log(`      ${f.subject}: ${f.reason}`);
}

if (dryRun) {
  console.log("\nDRY RUN — nothing written.");
  await prisma.$disconnect();
  process.exit(0);
}

console.log(`\n  stored ${stored} · revalidated ${touched} · recorded missing ${missed}`);

const after = await coverage();
console.log("\n── coverage ────────────────────────────────────────────────────");
console.log(`  fighters with an image : ${before.withImage} → ${after.withImage}  (+${after.withImage - before.withImage})`);
console.log(`  recorded missing       : ${before.missing} → ${after.missing}`);
console.log("\n  Rerun is cheap: held images revalidate with a conditional GET and transfer nothing.");

async function coverage() {
  const [withImage, missing] = await Promise.all([
    prisma.fighter.count({ where: { imageUrl: { not: null } } }),
    prisma.fighter.count({ where: { imageMissingAt: { not: null } } }),
  ]);
  return { withImage, missing };
}

await prisma.$disconnect();
