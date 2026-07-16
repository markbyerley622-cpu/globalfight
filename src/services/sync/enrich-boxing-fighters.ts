// Incremental boxing-fighter enrichment. Walks existing BOXING Fighter rows that
// are missing physical stats and fills them from the Boxing Data API's
// search-by-name endpoint (one request per fighter). Bounded per run so a
// scheduled job stays well under the RapidAPI free-tier quota (~500/month) —
// over successive runs it covers the whole roster.

import { prisma } from "@/lib/db";
import { log } from "@/lib/scraper/logger";
import { invalidate } from "@/lib/cache";
import { normalizeName } from "../normalization/names";
import { BoxingDataClient, type BDFighterDetail } from "../providers/boxing-data/client";

const SOURCE = "boxing-data";

interface Target { id: string; name: string; slug: string; countryCode: string | null }

function mapStance(s: string | null): "ORTHODOX" | "SOUTHPAW" | "SWITCH" | undefined {
  switch (s?.toLowerCase()) {
    case "orthodox": return "ORTHODOX";
    case "southpaw": return "SOUTHPAW";
    case "switch": return "SWITCH";
    default: return undefined;
  }
}

/** Choose the search hit that best matches our row (exact name, then country, then most bouts). */
function pickBest(t: Target, hits: BDFighterDetail[]): BDFighterDetail | null {
  const want = normalizeName(t.name);
  const exact = hits.filter((h) => normalizeName(h.name) === want);
  const pool = exact.length ? exact : [];
  if (!pool.length) return null;
  pool.sort((a, b) => {
    const ac = a.nationality_code === t.countryCode ? 1 : 0;
    const bc = b.nationality_code === t.countryCode ? 1 : 0;
    if (ac !== bc) return bc - ac;
    return (b.stats?.total_bouts ?? b.stats?.wins ?? 0) - (a.stats?.total_bouts ?? a.stats?.wins ?? 0);
  });
  return pool[0];
}

async function applyDetail(id: string, d: BDFighterDetail): Promise<void> {
  await prisma.fighter.update({
    where: { id },
    data: {
      nickname: d.nickname ?? d.alias ?? undefined,
      nationality: d.nationality ?? undefined,
      countryCode: d.nationality_code ?? undefined,
      heightCm: d.height_cm ?? undefined,
      reachCm: d.reach_cm ?? undefined,
      stance: mapStance(d.stance),
      wins: d.stats?.wins ?? undefined,
      losses: d.stats?.losses ?? undefined,
      draws: d.stats?.draws ?? undefined,
      lastScrapedAt: new Date(),
    },
  });
  try {
    await prisma.fighterExternalId.upsert({
      where: { source_externalId: { source: SOURCE, externalId: d.id } },
      update: { fighterId: id, confidence: 0.95 },
      create: { fighterId: id, source: SOURCE, externalId: d.id, confidence: 0.95 },
    });
  } catch { /* provenance table not migrated */ }
}

export async function enrichBoxingFighters(limit = 20): Promise<{ scanned: number; enriched: number }> {
  const key = process.env.BOXING_DATA_API_KEY?.trim() || process.env.RAPID_API?.trim();
  if (!key) { log.warn({}, "enrich:no-key"); return { scanned: 0, enriched: 0 }; }
  const client = new BoxingDataClient(key);

  // Oldest-touched boxing fighters missing physical stats first — so repeated
  // runs round-robin through the whole roster without re-spending on fresh rows.
  const targets = await prisma.fighter.findMany({
    where: { sport: "BOXING", OR: [{ heightCm: null }, { reachCm: null }] },
    select: { id: true, name: true, slug: true, countryCode: true },
    orderBy: { lastScrapedAt: { sort: "asc", nulls: "first" } },
    take: limit,
  });

  let enriched = 0;
  for (const t of targets) {
    try {
      const hits = await client.searchFighters(t.name);
      const best = pickBest(t, hits);
      if (!best) continue;
      await applyDetail(t.id, best);
      await invalidate(`fighter:${t.slug}`);
      enriched++;
    } catch (e) {
      log.warn({ name: t.name, err: (e as Error).message }, "enrich:fighter-failed");
    }
  }
  if (enriched) await invalidate("fighters:all");
  log.info({ scanned: targets.length, enriched }, "enrich:boxing-fighters:done");
  return { scanned: targets.length, enriched };
}
