import "server-only";
import { prisma } from "@/lib/db";
import { flags } from "@/lib/feature-flags";
import type { RankingConnector, RankingEntry } from "./connector";
import { ingestConnectors, INGEST_BLOCKLIST } from "./connectors";
import {
  fighterSlug, weightClassSlug, divisionOrder, shouldWriteRanking, movementFor,
} from "./ingest-rules";

// ════════════════════════════════════════════════════════════════════════
//  Ranking ingest — Layer 3+4. Takes a connector's normalized RankingEntry[]
//  and persists it with provenance and precedence:
//
//    identity resolve → WeightClass resolve → precedence check → Ranking upsert
//    → RankSnapshot (history)
//
//  Guarantees:
//    • Never ingests a blocklisted source (BoxRec) — checked here in code.
//    • Never overwrites a manual/curated row, or a higher-trust source.
//    • Idempotent: every write is an upsert keyed by natural identity, so a
//      re-run (or a partial run that failed midway) converges — no duplicates,
//      no half-state.
//    • A connector that throws records the failure and never blocks the others.
// ════════════════════════════════════════════════════════════════════════

export interface IngestStat {
  source: string;
  fetched: number;
  imported: number;
  skippedByPrecedence: number;
  fightersCreated: number;
  ok: boolean;
  error?: string;
}

/** Resolve a fighter by stable slug, creating a minimal record if unknown. */
async function resolveFighter(entry: RankingEntry): Promise<{ id: string; created: boolean }> {
  const slug = fighterSlug(entry.name);
  const existing = await prisma.fighter.findUnique({ where: { slug }, select: { id: true } });
  if (existing) return { id: existing.id, created: false };
  const created = await prisma.fighter.create({
    data: {
      slug,
      name: entry.name,
      sport: entry.sport.toUpperCase() as never,
      countryCode: entry.countryCode ?? undefined,
    },
    select: { id: true },
  });
  return { id: created.id, created: true };
}

/** Resolve (or create) the WeightClass for a division within a sport. */
async function resolveWeightClass(sport: string, division: string): Promise<string> {
  const sportEnum = sport.toUpperCase();
  const found = await prisma.weightClass.findFirst({
    where: { sport: sportEnum as never, name: division },
    select: { id: true },
  });
  if (found) return found.id;
  const created = await prisma.weightClass.create({
    data: {
      name: division,
      slug: weightClassSlug(sport, division),
      sport: sportEnum as never,
      order: divisionOrder(division),
    },
    select: { id: true },
  });
  return created.id;
}

/** Ingest ONE connector. Throws only on a fetch/parse failure (caller isolates). */
export async function ingestConnector(connector: RankingConnector): Promise<IngestStat> {
  // Defence in depth: a blocklisted source must never reach persistence even if
  // the registry were mis-edited to license it.
  if (INGEST_BLOCKLIST.has(connector.id)) {
    return { source: connector.id, fetched: 0, imported: 0, skippedByPrecedence: 0, fightersCreated: 0, ok: false, error: "blocklisted source" };
  }

  const stat: IngestStat = { source: connector.id, fetched: 0, imported: 0, skippedByPrecedence: 0, fightersCreated: 0, ok: true };
  const entries = await connector.fetch();
  stat.fetched = entries.length;

  for (const entry of entries) {
    // v1 persists ranked contenders (rank ≥ 1); champions (rank 0) belong in the
    // Champion table — a deliberate follow-up, not a silent drop of the list.
    if (entry.rank < 1) continue;
    try {
      const weightClassId = await resolveWeightClass(entry.sport, entry.weightClass);
      const { id: fighterId, created } = await resolveFighter(entry);
      if (created) stat.fightersCreated++;

      const existing = await prisma.ranking.findUnique({
        where: { weightClassId_isPoundForPound_fighterId: { weightClassId, isPoundForPound: false, fighterId } },
        select: { rank: true, source: true },
      });

      if (!shouldWriteRanking(existing?.source, connector.id)) {
        stat.skippedByPrecedence++;
        continue;
      }

      const previousRank = existing?.rank ?? null;
      const movement = movementFor(previousRank, entry.rank);

      await prisma.ranking.upsert({
        where: { weightClassId_isPoundForPound_fighterId: { weightClassId, isPoundForPound: false, fighterId } },
        create: { weightClassId, fighterId, isPoundForPound: false, rank: entry.rank, previousRank, movement, source: connector.id },
        update: { rank: entry.rank, previousRank, movement, source: connector.id },
      });

      // Append-only history point (movement graphs, "highest ranking", weekly deltas).
      await prisma.rankSnapshot.create({
        data: { fighterId, weightClass: entry.weightClass, isPoundForPound: false, rank: entry.rank },
      });

      stat.imported++;
    } catch (e) {
      // One bad row must not abort the source; record and continue.
      stat.error = (e as Error).message;
    }
  }
  return stat;
}

/**
 * Run every currently-ingestible connector (licensed + ready + not blocked),
 * isolating failures. Master-gated: returns an empty run if the ingest flag is
 * off, so this is safe to wire into cron unconditionally.
 */
export async function ingestAllRankings(): Promise<IngestStat[]> {
  if (!flags().rankingsIngestEnabled) return [];
  const connectors = ingestConnectors();
  const stats: IngestStat[] = [];
  for (const c of connectors) {
    try {
      stats.push(await ingestConnector(c));
    } catch (e) {
      stats.push({ source: c.id, fetched: 0, imported: 0, skippedByPrecedence: 0, fightersCreated: 0, ok: false, error: (e as Error).message });
    }
  }
  return stats;
}
