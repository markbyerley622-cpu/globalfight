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
import { resolveOrCreateFighter } from "@/lib/registry/identity";
import { log } from "./logger";
import type { ScrapedMmaFighter } from "./mma";

/**
 * Persist a scraped MMA roster (sport=MMA).
 *
 * Identity goes through the canonical resolver rather than `upsert({ where: {
 * slug } })`. The nationality this source carries is real corroboration — it is
 * exactly the fact that separates two fighters who share a name — so it is
 * passed in rather than only being written after the fact.
 *
 * Bio fields are then filled with `?? undefined`, which in Prisma means "leave
 * whatever is already there". A roster scrape adds what the registry is missing
 * and never blanks a field a better source already filled.
 */
export async function persistMmaRoster(rows: ScrapedMmaFighter[]): Promise<number> {
  let written = 0;
  for (const r of rows) {
    if (!slugify(r.name)) continue;

    const { fighterId } = await resolveOrCreateFighter(
      {
        name: r.name,
        sport: "MMA",
        nickname: r.nickname ?? null,
        nationality: r.nationality ?? null,
        countryCode: r.countryCode ?? null,
      },
      { origin: "mma-roster", sportFallback: "MMA" },
    );

    await prisma.fighter.update({
      where: { id: fighterId },
      // `sport` is intentionally NOT updated — the first source to create a
      // fighter owns its sport, so re-scrapes never flip a boxer to MMA. The
      // display NAME is no longer updated either: the resolver has already
      // recorded this source's spelling as an alias, and rewriting the
      // registry's own label to whichever source ran last is how a canonical
      // name stops being canonical.
      data: {
        nickname: r.nickname ?? undefined,
        nationality: r.nationality ?? undefined,
        countryCode: r.countryCode ?? undefined,
        heightCm: r.heightCm ?? undefined,
        wins: r.record.wins, losses: r.record.losses, draws: r.record.draws,
        lastScrapedAt: new Date(),
      },
    });
    written++;
  }
  await invalidate("fighters:all");
  log.info({ written }, "persistMmaRoster:done");
  return written;
}
