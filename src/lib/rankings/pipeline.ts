import "server-only";
import { createHash } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { reconcileList, type Observation, type Tier } from "@/lib/registry/reconcile";
import type { RankingConnector, RankingEntry, TrustLevel } from "./connector";
import { movementFor } from "./ingest-rules";

// ════════════════════════════════════════════════════════════════════════════
//  THE RANKING PIPELINE — observe, then project.
//
//      connector ──► RankingObservation ──► reconciler ──► Ranking
//                    (what a source SAID)                  (what we publish)
//
//  Connectors no longer write `Ranking`. They record what they saw, and a
//  separate deterministic pass decides what to publish from ALL the evidence.
//
//  ── What this fixes ──────────────────────────────────────────────────────
//  `Ranking` is unique per (division, p4p, fighter, organisation), so the old
//  ingest resolved provider conflicts by overwriting a single row. The losing
//  value never landed, which meant a conflict could not be DETECTED, a published
//  number could not explain itself, and the outcome depended on which connector
//  happened to run first whenever trust tiers tied.
//
//  ── Incremental by default ───────────────────────────────────────────────
//  A provider's normalized payload is hashed. Identical hash → nothing is
//  written at all: no observations, no projection, no snapshots. The old
//  pipeline re-wrote every row and appended a RankSnapshot per fighter per run
//  whether or not anything had changed.
// ════════════════════════════════════════════════════════════════════════════

/** Connector trust tier → evidence tier. The two vocabularies, reconciled. */
const TIER_OF: Record<TrustLevel, Tier> = {
  official: "OFFICIAL",
  commission: "OFFICIAL",
  promotion: "OFFICIAL",
  federation: "OFFICIAL",
  // Reputable media is independent secondary reporting — the same standing as an
  // encyclopaedia, and explicitly NOT the organisation speaking about itself.
  media: "ENCYCLOPAEDIC",
  community: "AGGREGATOR",
  unknown: "INTERNAL",
};

export const tierOf = (trust: TrustLevel): Tier => TIER_OF[trust] ?? "INTERNAL";

/**
 * A stable fingerprint of what a provider published.
 *
 * Sorted before hashing, so a source that reorders its HTML without changing its
 * ranking produces the same hash and costs us nothing. Only the fields that
 * carry meaning are included — a changed `sourceUrl` query string must not look
 * like a new ranking.
 */
export function payloadHash(entries: RankingEntry[]): string {
  const canonical = entries
    .map((e) => [e.organisation, e.weightClass, e.isPoundForPound ? "p4p" : "div", e.gender, e.rank, e.name].join("|"))
    .sort()
    .join("\n");
  return createHash("sha256").update(canonical).digest("hex");
}

export interface ObserveResult {
  /** True when the payload was byte-identical to the last run. */
  unchanged: boolean;
  written: number;
  skipped: number;
}

/**
 * Record what a connector published.
 *
 * `fighterIdFor` is injected rather than imported so this stays testable without
 * a database and, more importantly, so the caller owns identity resolution — an
 * observation is only written once its subject resolves to a canonical fighter.
 * A row whose fighter could not be resolved is NOT recorded against a guess.
 */
export async function recordObservations(
  connector: RankingConnector,
  entries: RankingEntry[],
  resolve: (entry: RankingEntry) => Promise<{ fighterId: string; weightClassId: string } | null>,
): Promise<ObserveResult> {
  const hash = payloadHash(entries);
  const checkpoint = await prisma.providerCheckpoint
    .findUnique({ where: { provider_scope: { provider: connector.id, scope: "rankings" } } })
    .catch(() => null);

  if (checkpoint?.payloadHash === hash) {
    // Record that we CHECKED without touching lastChangedAt. Those are two
    // different facts, and a dashboard that conflates them reports a dead
    // provider as healthy.
    await touchCheckpoint(connector.id, "rankings", { lastCheckedAt: new Date(), failureStreak: 0, lastError: null });
    return { unchanged: true, written: 0, skipped: entries.length };
  }

  const tier = tierOf(connector.trust);
  const confidence = tier === "OFFICIAL" ? 1 : tier === "ENCYCLOPAEDIC" ? 0.8 : 0.65;
  let written = 0;
  let skipped = 0;

  for (const entry of entries) {
    // rank 0 is a titleholder, not a contender — handled by the champion
    // pipeline, which reads the same connector output.
    if (entry.rank < 1) { skipped++; continue; }

    const resolved = await resolve(entry);
    if (!resolved) { skipped++; continue; }

    const effectiveDate = new Date(entry.effectiveDate);
    if (Number.isNaN(effectiveDate.getTime())) { skipped++; continue; }

    try {
      // createMany(skipDuplicates) rather than create: re-running the same
      // publication must be a no-op, not a P2002 that aborts the whole source
      // (CLAUDE.md rule 4).
      const { count } = await prisma.rankingObservation.createMany({
        data: [{
          provider: connector.id,
          tier,
          fighterId: resolved.fighterId,
          divisionLabel: entry.weightClass,
          weightClassId: resolved.weightClassId,
          isPoundForPound: entry.isPoundForPound === true,
          organisation: entry.organisation ?? "",
          rank: entry.rank,
          effectiveDate,
          sourceUrl: entry.sourceUrl,
          confidence,
          payloadHash: hash,
        }],
        skipDuplicates: true,
      });
      written += count;
    } catch {
      skipped++;
    }
  }

  await touchCheckpoint(connector.id, "rankings", {
    payloadHash: hash,
    lastCheckedAt: new Date(),
    lastChangedAt: new Date(),
    failureStreak: 0,
    lastError: null,
  });

  return { unchanged: false, written, skipped };
}

/** Upsert a provider's incremental-sync state. Best-effort; never fatal. */
export async function touchCheckpoint(
  provider: string,
  scope: string,
  data: Prisma.ProviderCheckpointUncheckedUpdateInput,
): Promise<void> {
  await prisma.providerCheckpoint
    .upsert({
      where: { provider_scope: { provider, scope } },
      // Spread FIRST, then the keys — the identity of the row is not the
      // caller's to override, and spreading last silently let it be.
      create: { ...(data as Prisma.ProviderCheckpointUncheckedCreateInput), provider, scope },
      update: data,
    })
    .catch(() => {});
}

/** Record that a provider failed, so a streak is visible before anyone asks. */
export async function recordFailure(provider: string, scope: string, error: string): Promise<void> {
  const existing = await prisma.providerCheckpoint
    .findUnique({ where: { provider_scope: { provider, scope } }, select: { failureStreak: true } })
    .catch(() => null);
  await touchCheckpoint(provider, scope, {
    lastCheckedAt: new Date(),
    failureStreak: (existing?.failureStreak ?? 0) + 1,
    lastError: error.slice(0, 500),
  });
}

export interface ProjectionStat {
  lists: number;
  rowsWritten: number;
  rowsRemoved: number;
  contested: number;
}

/**
 * Project observations into the published `Ranking` board.
 *
 * Runs per LIST (division × p4p × organisation), because a ranking is an ORDER
 * and mixing two providers position by position produces a board neither of them
 * ever published — see reconcileList.
 *
 * Rows the winning board does not contain are DELETED for that list. A fighter
 * who dropped out of a division's top 15 has to leave the board; leaving them
 * behind is how a stale name sits at #14 forever.
 */
export async function projectRankings(now = new Date()): Promise<ProjectionStat> {
  const stat: ProjectionStat = { lists: 0, rowsWritten: 0, rowsRemoved: 0, contested: 0 };

  const lists = await prisma.rankingObservation.groupBy({
    by: ["weightClassId", "isPoundForPound", "organisation"],
    where: { weightClassId: { not: null } },
  });

  for (const list of lists) {
    if (!list.weightClassId) continue;
    stat.lists++;

    const rows = await prisma.rankingObservation.findMany({
      where: {
        weightClassId: list.weightClassId,
        isPoundForPound: list.isPoundForPound,
        organisation: list.organisation,
      },
      orderBy: { effectiveDate: "desc" },
      // Bounded: a division with years of history must not load all of it to
      // decide today's board. Ordered by effectiveDate, so the newest
      // publication of every provider is comfortably inside this window.
      take: 500,
    });
    if (rows.length === 0) continue;

    const observations: Observation<{ key: string; fighterId: string; rank: number }>[] = rows.map((r) => ({
      id: r.id,
      provider: r.provider,
      tier: r.tier as Tier,
      effectiveDate: r.effectiveDate,
      retrievedAt: r.retrievedAt,
      sourceUrl: r.sourceUrl,
      value: { key: r.fighterId, fighterId: r.fighterId, rank: r.rank },
    }));

    const outcome = reconcileList(observations, { now });
    if (!outcome) continue;
    if (outcome.decision.contested) stat.contested++;

    const keep = new Set<string>();
    for (const obs of outcome.winner) {
      const { fighterId, rank } = obs.value;
      keep.add(fighterId);

      const key = {
        weightClassId_isPoundForPound_fighterId_organisation: {
          weightClassId: list.weightClassId,
          isPoundForPound: list.isPoundForPound,
          fighterId,
          organisation: list.organisation,
        },
      };
      const existing = await prisma.ranking.findUnique({ where: key, select: { rank: true } });
      const previousRank = existing?.rank ?? null;

      // Unchanged rows are left alone entirely — no write, no snapshot. The old
      // pipeline rewrote every row on every run.
      if (existing && existing.rank === rank) continue;

      await prisma.ranking.upsert({
        where: key,
        create: {
          weightClassId: list.weightClassId,
          fighterId,
          isPoundForPound: list.isPoundForPound,
          organisation: list.organisation,
          rank,
          previousRank,
          movement: movementFor(previousRank, rank),
          source: outcome.decision.provider,
          tier: outcome.decision.tier,
          effectiveDate: outcome.decision.effectiveDate,
          sourceUrl: outcome.decision.sourceUrl,
          confidence: outcome.decision.confidence,
          agreementCount: outcome.decision.agreementCount,
          contested: outcome.decision.contested,
          observationIds: [obs.id],
          reconciledAt: now,
        },
        update: {
          rank,
          previousRank,
          movement: movementFor(previousRank, rank),
          source: outcome.decision.provider,
          tier: outcome.decision.tier,
          effectiveDate: outcome.decision.effectiveDate,
          sourceUrl: outcome.decision.sourceUrl,
          confidence: outcome.decision.confidence,
          agreementCount: outcome.decision.agreementCount,
          contested: outcome.decision.contested,
          observationIds: [obs.id],
          reconciledAt: now,
        },
      });
      stat.rowsWritten++;

      // History, appended only when the rank actually MOVED.
      await prisma.rankSnapshot
        .create({ data: { fighterId, weightClass: list.weightClassId, isPoundForPound: list.isPoundForPound, rank } })
        .catch(() => {});
    }

    // Anyone the winning board dropped. Scoped to rows this pipeline owns:
    // a curated or manually-entered row is not the projection's to delete.
    const removable = await prisma.ranking.findMany({
      where: {
        weightClassId: list.weightClassId,
        isPoundForPound: list.isPoundForPound,
        organisation: list.organisation,
        fighterId: { notIn: [...keep] },
        source: { notIn: ["manual", "curated"] },
      },
      select: { id: true },
    });
    if (removable.length) {
      const { count } = await prisma.ranking.deleteMany({ where: { id: { in: removable.map((r) => r.id) } } });
      stat.rowsRemoved += count;
    }
  }

  return stat;
}
