// ════════════════════════════════════════════════════════════════════════
//  Ingest layer — persist scraped rows into PostgreSQL via Prisma.
//
//  Idempotent upserts keyed on slug so re-running a scrape never duplicates.
//
//  NOTE: the BoxRec ingest paths (rankings / events / people / fighter profiles)
//  were removed — Combat Register no longer scrapes BoxRec. Rankings, events and
//  fighter bios now come from the licensed API providers (src/services) and the
//  mock-data layer. Only the Wikipedia-sourced MMA roster persister remains here.
// ════════════════════════════════════════════════════════════════════════

import { prisma } from "@/lib/db";
import { slugify } from "@/lib/utils";
import { invalidate } from "@/lib/cache";
import { log } from "./logger";
import type { ScrapedMmaFighter } from "./mma";

/** Persist a scraped MMA roster (sport=MMA). Idempotent upsert keyed on slug. */
export async function persistMmaRoster(rows: ScrapedMmaFighter[]): Promise<number> {
  let written = 0;
  for (const r of rows) {
    const slug = slugify(r.name);
    if (!slug) continue;
    await prisma.fighter.upsert({
      where: { slug },
      // sport is intentionally NOT updated — the first source to create a
      // fighter owns its sport, so re-scrapes never flip a boxer to MMA etc.
      update: {
        name: r.name,
        nickname: r.nickname ?? undefined,
        nationality: r.nationality ?? undefined,
        countryCode: r.countryCode ?? undefined,
        heightCm: r.heightCm ?? undefined,
        wins: r.record.wins, losses: r.record.losses, draws: r.record.draws,
        lastScrapedAt: new Date(),
      },
      create: {
        slug, name: r.name, sport: "MMA",
        nickname: r.nickname ?? null,
        nationality: r.nationality ?? null,
        countryCode: r.countryCode ?? null,
        heightCm: r.heightCm ?? null,
        wins: r.record.wins, losses: r.record.losses, draws: r.record.draws,
      },
    });
    written++;
  }
  await invalidate("fighters:all");
  log.info({ written }, "persistMmaRoster:done");
  return written;
}
