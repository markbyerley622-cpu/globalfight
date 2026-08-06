import "server-only";
import { prisma } from "@/lib/db";
import { flags } from "@/lib/feature-flags";
import type { RankingConnector, RankingEntry } from "./connector";
import { ingestConnectors, INGEST_BLOCKLIST } from "./connectors";
import type { Sport } from "@prisma/client";
import { resolveOrCreateFighter } from "@/lib/registry/identity";
import { log } from "@/lib/scraper/logger";
import { weightClassSlug, divisionOrder } from "./ingest-rules";
import { recordObservations, recordFailure, projectRankings } from "./pipeline";
import { recordChampionObservation, projectChampions } from "./champions";

// ════════════════════════════════════════════════════════════════════════
//  Ranking ingest — the OBSERVE half of the pipeline.
//
//    connector ──► RankingObservation ──► (projectRankings) ──► Ranking
//
//  This module no longer decides anything. It resolves identity, records what
//  the provider published, and stops. What gets PUBLISHED is decided by
//  projectRankings() over every provider's evidence at once — see pipeline.ts.
//
//  ── Why the split ────────────────────────────────────────────────────────
//  The old shape resolved provider conflicts by overwriting a single Ranking row
//  (`shouldWriteRanking` + upsert), so the losing value never landed. A conflict
//  could not be detected, a published rank could not explain itself, and the
//  outcome depended on which connector ran first whenever trust tiers tied.
//
//  Guarantees kept from before:
//    • Never ingests a blocklisted source (BoxRec) — checked here in code.
//    • Idempotent: an identical payload writes NOTHING, and re-recording the
//      same publication is a no-op rather than a duplicate row.
//    • A connector that throws records the failure and never blocks the others.
// ════════════════════════════════════════════════════════════════════════

export interface IngestStat {
  source: string;
  fetched: number;
  imported: number;
  /** Observations recorded this run. */
  observed: number;
  /** True when the provider's payload was byte-identical to the last run. */
  unchanged: boolean;
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

/**
 * Resolve the fighter a ranking row is ABOUT, through the canonical resolver.
 *
 * This used to be `findUnique({ where: { slug: fighterSlug(name) } })` — a human
 * being identified by a slug derived from their display name. On a RANKING that
 * is the worst place for it: the board is the most visible published artefact in
 * the product, so a mis-resolved row puts the wrong person's face at #3, and a
 * name-variant row ("Alex" vs "Alexander") silently creates a second fighter who
 * then holds a rank with no bouts, no record and no photo.
 *
 * The resolver may now answer "I am not sure", which the old code could not
 * express. That is not a failure: it creates a provisional entry and queues the
 * pair for review, so the board still publishes and the ambiguity is visible
 * instead of being resolved by a coin flip.
 */
async function resolveFighterFor(entry: RankingEntry): Promise<{ id: string; created: boolean } | null> {
  const result = await resolveOrCreateFighter(
    {
      name: entry.name,
      sport: entry.sport.toUpperCase() as Sport,
      countryCode: entry.countryCode,
    },
    { origin: "ranking-ingest", sportFallback: entry.sport.toUpperCase() as Sport },
  );
  // A ratings table's own labels reach here as "names" — "INT. CHAMP:" held a
  // WBA world title because of exactly this path. Refused, and reported, rather
  // than becoming a fighter. See lib/registry/artefacts.
  if (result.artefact || !result.fighterId) {
    log.warn(
      { name: entry.name, organisation: entry.organisation, reason: result.artefact?.reason },
      "rankings:name-artefact-skipped",
    );
    return null;
  }
  return { id: result.fighterId, created: result.created };
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
    return { source: connector.id, fetched: 0, imported: 0, observed: 0, unchanged: false, championsImported: 0, skippedByPrecedence: 0, fightersCreated: 0, ok: false, error: "blocklisted source" };
  }

  const stat: IngestStat = { source: connector.id, fetched: 0, imported: 0, observed: 0, unchanged: false, championsImported: 0, skippedByPrecedence: 0, fightersCreated: 0, ok: true };
  const entries = await connector.fetch();
  stat.fetched = entries.length;

  // ── EVIDENCE FIRST ──────────────────────────────────────────────────────
  // Record what this provider published before deciding anything. The
  // observation table is append-only, so a source that disagrees with a
  // higher-tier one is preserved rather than discarded — which is what makes a
  // conflict visible at all. Projection into the published board happens
  // separately, over ALL providers' evidence, in projectRankings().
  //
  // An identical payload short-circuits here: no observations, no projection,
  // no snapshots. The old pipeline rewrote every row on every run.
  const observed = await recordObservations(connector, entries, async (entry) => {
    const resolved = await resolveFighterFor(entry);
    if (!resolved) return null;
    const weightClassId = await resolveWeightClass(entry.sport, entry.weightClass);
    if (resolved.created) stat.fightersCreated++;
    return { fighterId: resolved.id, weightClassId };
  });
  stat.observed = observed.written;
  stat.unchanged = observed.unchanged;

  // ── TITLEHOLDERS ────────────────────────────────────────────────────────
  // rank 0 is the champion a source lists above its contenders. Contender rows
  // are now handled entirely by the observation + projection path above; only
  // titles are still written from here, and only until the champion pipeline
  // takes them over the same way (see lib/rankings/champions).
  if (observed.unchanged) return stat;

  for (const entry of entries) {
    if (entry.rank >= 1) continue;
    try {
      const resolved = await resolveFighterFor(entry);
      if (!resolved) continue;
      const weightClassId = await resolveWeightClass(entry.sport, entry.weightClass);
      if (resolved.created) stat.fightersCreated++;
      const fighterId = resolved.id;

      await recordChampionObservation(connector, entry, fighterId, weightClassId);

      // Counts only what actually CHANGED — an unmapped organisation and an
      // unchanged champion both return false, and reporting either as an
      // import would make a no-op run look like it did work.
      if (await upsertChampion({ fighterId, weightClassId, organisation: entry.organisation })) {
        stat.championsImported++;
      }
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
      const error = (e as Error).message;
      // A failure streak is a fact worth holding. One failure is noise; eleven
      // in a row is an outage, and nobody should have to read logs to find that
      // out — the admin dashboard reads this.
      await recordFailure(c.id, "rankings", error);
      stats.push({ source: c.id, fetched: 0, imported: 0, observed: 0, unchanged: false, championsImported: 0, skippedByPrecedence: 0, fightersCreated: 0, ok: false, error });
    }
  }

  // ── PROJECT ─────────────────────────────────────────────────────────────
  // Once, after every provider has been observed — not per connector. The whole
  // point of reconciliation is that it sees ALL the evidence at the same time;
  // projecting inside the loop would decide each list against whichever sources
  // happened to have run already, which is the ordering dependence this
  // architecture exists to remove.
  const [ranked, champions] = await Promise.all([projectRankings(), projectChampions()]);
  log.info({ ranked, champions }, "rankings:projected");

  return stats;
}
