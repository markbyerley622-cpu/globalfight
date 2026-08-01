import { NextResponse } from "next/server";
import { cronAuthorized } from "@/lib/scraper/cron-handler";
import { prisma } from "@/lib/db";
import { processAndStoreBuffer } from "@/lib/images/store";
import { syncMedia, MEDIA_PROVIDERS } from "@/lib/media";
import type { MediaSubject } from "@/lib/media/types";
import { log } from "@/lib/scraper/logger";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * Fighter image refresh.
 *
 *   ?mode=new        (default) fighters with no image yet — the ongoing fill
 *   ?mode=revalidate weekly. Conditional GET over images we already hold; a full
 *                    pass transfers essentially nothing (measured: 15/15 → 304,
 *                    0.00 MB).
 *   ?mode=retry      monthly. Fighters a provider 404'd, past the 30-day backoff.
 *
 * Bounded by IMAGE_CRON_BATCH so one tick fits inside maxDuration. Each fighter
 * is persisted the moment its outcome is known, so a timeout mid-run keeps
 * everything already done.
 */
const BATCH = Number(process.env.IMAGE_CRON_BATCH ?? 120);

export async function GET(req: Request) {
  if (!cronAuthorized(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const mode = new URL(req.url).searchParams.get("mode") ?? "new";
  const now = new Date();
  const started = Date.now();

  const where =
    mode === "revalidate"
      ? { externalIds: { some: { source: "espn" } }, imageUrl: { not: null }, imageContentHash: { not: null } }
      : mode === "retry"
        ? { externalIds: { some: { source: "espn" } }, imageUrl: null, imageMissingAt: { not: null } }
        : { externalIds: { some: { source: "espn" } }, imageUrl: null, imageMissingAt: null };

  const rows = await prisma.fighter.findMany({
    where,
    orderBy: [{ imageFetchedAt: { sort: "asc", nulls: "first" } }],
    take: BATCH,
    select: {
      id: true, slug: true, name: true,
      imageTier: true, imageETag: true, imageLastModified: true, imageContentHash: true,
      imageMissingAt: true, imageUrl: true,
      externalIds: { where: { source: "espn" }, select: { source: true, externalId: true } },
    },
  });

  const subjects: MediaSubject[] = rows.map((f) => ({
    id: f.id,
    slug: f.slug,
    name: f.name,
    externalIds: Object.fromEntries(f.externalIds.map((x) => [x.source, x.externalId])),
    held: {
      tier: f.imageUrl ? f.imageTier : null,
      etag: f.imageUrl ? f.imageETag : null,
      lastModified: f.imageUrl ? f.imageLastModified : null,
      contentHash: f.imageUrl ? f.imageContentHash : null,
    },
    ...(f.imageMissingAt ? { missingAt: f.imageMissingAt } : {}),
  })) as MediaSubject[];

  const { report } = await syncMedia({
    subjects,
    providers: MEDIA_PROVIDERS,
    now,
    // The retry tick exists precisely to look past the backoff.
    force: mode === "retry",
    delayMs: Number(process.env.IMAGE_RATE_LIMIT_MS ?? 250),
    onSubjectDone: async (w) => {
      if (w.stored) {
        const images = await processAndStoreBuffer(w.stored.slug, w.stored.buffer);
        await prisma.fighter.update({
          where: { id: w.subjectId },
          data: {
            thumbUrl: images.thumbUrl, imageUrl: images.imageUrl, heroImageUrl: images.heroImageUrl,
            imageTier: w.stored.tier, imageSource: w.stored.source, imageSourceUrl: w.stored.sourceUrl,
            imageETag: w.stored.etag, imageLastModified: w.stored.lastModified,
            imageContentHash: w.stored.contentHash, imageMimeType: w.stored.mimeType,
            imageFetchedAt: now, imageMissingAt: null, imageMissReason: null,
            imageAttempts: { increment: 1 },
          },
        });
      } else if (w.touchedAt) {
        await prisma.fighter.update({
          where: { id: w.subjectId },
          data: { imageFetchedAt: w.touchedAt, imageAttempts: { increment: 1 } },
        });
      } else if (w.missing) {
        await prisma.fighter.update({
          where: { id: w.subjectId },
          data: { imageMissingAt: w.missing.at, imageMissReason: w.missing.reason, imageAttempts: { increment: 1 } },
        });
      }
    },
  });

  const durationMs = Date.now() - started;
  const failed = report.byOutcome.failed + report.byOutcome["storage-failed"];

  // A tick in which every subject failed is a FAILED tick and must answer with an
  // HTTP error, or `curl -fsS` in render.yaml sees success and the dashboard shows
  // green while nothing works.
  if (subjects.length > 0 && failed === subjects.length) {
    log.error({ mode, durationMs, report }, "cron:images:all-failed");
    return NextResponse.json({ ok: false, mode, durationMs, report }, { status: 502 });
  }

  log.info({ mode, durationMs, considered: report.considered, ...report.byOutcome }, "cron:images:done");
  return NextResponse.json({ ok: true, mode, durationMs, report });
}
