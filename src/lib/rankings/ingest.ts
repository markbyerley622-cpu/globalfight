import "server-only";
import { prisma } from "@/lib/db";
import { flags } from "@/lib/feature-flags";
import type { RankingConnector, RankingEntry } from "./connector";
import { ingestConnectors, INGEST_BLOCKLIST } from "./connectors";
import {
  fighterSlug, weightClassSlug, divisionOrder, shouldWriteRanking, movementFor,
} from "./ingest-rules";
import { notifyRankingChange } from "@/lib/social/fighter-triggers";

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
  /** Titleholders (rank 0) written to the Champion table. */
  championsImported: number;
  skippedByPrecedence: number;
  fightersCreated: number;
  ok: boolean;
  error?: string;
}

/**
 * An organisation string → the SanctioningBody enum, or null when we have no
 * enum member for it.
 *
 * Returning null (and skipping the champion) rather than guessing is the point:
 * a champion row asserts "this person holds this organisation's title", and
 * filing it under the wrong body is a worse outcome than not recording it. A
 * new promotion is one enum member away from being supported.
 */
function sanctioningBodyFor(organisation: string): "WBA" | "WBC" | "IBF" | "WBO" | "IBO" | "BKFC" | "ONE" | "PFL" | "UFC" | "BELLATOR" | "GLORY" | "RIZIN" | "KSW" | null {
  const key = organisation.trim().toUpperCase().replace(/[^A-Z]/g, "");
  const known = ["WBA", "WBC", "IBF", "WBO", "IBO", "BKFC", "ONE", "PFL", "UFC", "BELLATOR", "GLORY", "RIZIN", "KSW"] as const;
  return (known as readonly string[]).includes(key) ? (key as ReturnType<typeof sanctioningBodyFor>) : null;
}

/**
 * Record the CURRENT titleholder of a division. Idempotent: re-ingesting the
 * same champion is a no-op, and a new champion replaces the row in place.
 *
 * In place, and not by retiring the old row, because of the shape of the
 * constraint: Champion is `@@unique([weightClassId, body, current])` on a
 * BOOLEAN, which permits at most two rows per (division, body) for all time —
 * one current, one not. Flipping a superseded champion to `current: false`
 * therefore succeeds exactly once per division and then collides forever on the
 * third titleholder.
 *
 * So Champion holds the present, and title HISTORY belongs to the `Title` model
 * (fighterId + wonDate/lostDate + current), which is designed for it and has no
 * such ceiling. Nothing is lost by updating here.
 */
async function upsertChampion(
  { fighterId, weightClassId, organisation }: { fighterId: string; weightClassId: string; organisation: string },
): Promise<boolean> {
  const body = sanctioningBodyFor(organisation);
  if (!body) return false;
  const existing = await prisma.champion.findFirst({
    where: { weightClassId, body, current: true },
    select: { id: true, fighterId: true },
  });
  if (existing?.fighterId === fighterId) return false; // unchanged
  if (existing) {
    await prisma.champion.update({ where: { id: existing.id }, data: { fighterId, since: null, defenses: 0 } });
    return true;
  }
  await prisma.champion.create({ data: { fighterId, weightClassId, body, current: true } });
  return true;
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
    return { source: connector.id, fetched: 0, imported: 0, championsImported: 0, skippedByPrecedence: 0, fightersCreated: 0, ok: false, error: "blocklisted source" };
  }

  const stat: IngestStat = { source: connector.id, fetched: 0, imported: 0, championsImported: 0, skippedByPrecedence: 0, fightersCreated: 0, ok: true };
  const entries = await connector.fetch();
  stat.fetched = entries.length;

  for (const entry of entries) {
    try {
      const weightClassId = await resolveWeightClass(entry.sport, entry.weightClass);
      const { id: fighterId, created } = await resolveFighter(entry);
      if (created) stat.fightersCreated++;

      // rank 0 = the titleholder the source lists above its contenders. These
      // used to be `continue`d, and the consequence was measurable: the Champion
      // table held ZERO rows for every sport, so /champions and every "current
      // champion" surface rendered empty while the connectors were parsing the
      // champion's name on every run and throwing it away.
      if (entry.rank < 1) {
        // Counts only what actually CHANGED — an unmapped organisation and an
        // unchanged champion both return false, and reporting either as an
        // import would make a no-op run look like it did work.
        if (await upsertChampion({ fighterId, weightClassId, organisation: entry.organisation })) {
          stat.championsImported++;
        }
        continue;
      }

      const isPoundForPound = entry.isPoundForPound === true;
      const organisation = entry.organisation ?? "";
      const key = {
        weightClassId_isPoundForPound_fighterId_organisation: {
          weightClassId, isPoundForPound, fighterId, organisation,
        },
      };

      const existing = await prisma.ranking.findUnique({
        where: key,
        select: { rank: true, source: true },
      });

      if (!shouldWriteRanking(existing?.source, connector.id)) {
        stat.skippedByPrecedence++;
        continue;
      }

      const previousRank = existing?.rank ?? null;
      const movement = movementFor(previousRank, entry.rank);

      await prisma.ranking.upsert({
        where: key,
        create: { weightClassId, fighterId, isPoundForPound, organisation, rank: entry.rank, previousRank, movement, source: connector.id },
        update: { rank: entry.rank, previousRank, movement, source: connector.id },
      });

      // Append-only history point (movement graphs, "highest ranking", weekly deltas).
      await prisma.rankSnapshot.create({
        data: { fighterId, weightClass: entry.weightClass, isPoundForPound, rank: entry.rank },
      });

      // FOLLOWERS. Gated inside the trigger on movement being MEANINGFUL — entering
      // the list, or two places or more. This runs on cron and a one-place shuffle
      // caused by somebody else's fight is not news about this fighter, so notifying
      // on every delta would make the rankings the noisiest producer in the app.
      await notifyRankingChange({
        fighterId,
        weightClass: entry.weightClass,
        rank: entry.rank,
        previousRank,
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
      stats.push({ source: c.id, fetched: 0, imported: 0, championsImported: 0, skippedByPrecedence: 0, fightersCreated: 0, ok: false, error: (e as Error).message });
    }
  }
  return stats;
}
