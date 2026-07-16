// Sync orchestration: APIs first, scraper fallback. For each sport it runs the
// aggregator, records ProviderHealth (one row per source touched) and a
// ProviderSync summary. If no configured API produced any records, it triggers
// the existing scraper refresh() for the matching entity and marks the sync
// FALLBACK.
//
// Aggregated records are persisted into Fighter/Event/Fight via persistAggregated
// (real Prisma upserts, keyed on slug/externalId — idempotent). The free ESPN
// provider needs no key, so `npm run sync:free` pulls real data end-to-end today.

import { prisma } from "@/lib/db";
import { log } from "@/lib/scraper/logger";
import type { Sport } from "@/lib/types";
import { refresh, type RefreshKind } from "@/lib/scraper/runner";
import { ensureDataSources } from "./seed";
import { aggregateEvents, aggregateFighters, type SourceTelemetry } from "../aggregator";
import { persistAggregated } from "./persist";

export type SyncEntity = "events" | "fighters" | "results";

const FALLBACK_KIND: Record<SyncEntity, RefreshKind> = {
  events: "events",
  results: "results",
  fighters: "mma",
};

export interface SyncOutcome {
  sport: Sport;
  entity: SyncEntity;
  status: "SUCCESS" | "FALLBACK" | "FAILED";
  apiRecords: number;
  fellBackTo?: string;
  error?: string;
}

export async function syncSportEntity(sport: Sport, entity: SyncEntity): Promise<SyncOutcome> {
  // Telemetry/provenance tables are additive — when a DB hasn't run `db:push`
  // yet they're absent. The core enrichment (Event/Fighter/Fight) only touches
  // long-existing columns, so we degrade the bookkeeping gracefully rather than
  // aborting the whole sync.
  await ensureDataSources().catch((e) => log.warn({ err: (e as Error).message }, "sync:seed-skipped"));
  const startedAt = new Date();
  const sync = await prisma.providerSync
    .create({ data: { sourceKey: "scraper", sport, entity, status: "RUNNING", startedAt } })
    .catch(() => null);

  try {
    const agg = entity === "fighters"
      ? await aggregateFighters(sport)
      : await aggregateEvents(sport);

    await recordHealth(agg.telemetry).catch(() => {});
    const apiRecords = agg.records.length;
    const rateLimitHits = agg.telemetry.filter((t) => t.rateLimited).length;
    const failures = agg.telemetry.filter((t) => !t.ok).length;

    if (apiRecords === 0) {
      const fellBackTo = "scraper";
      await refresh(FALLBACK_KIND[entity]);
      await finish(sync?.id, startedAt, { status: "FALLBACK", imported: 0, failures, rateLimitHits, fellBackTo });
      log.info({ sport, entity }, "sync:fallback→scraper");
      return { sport, entity, status: "FALLBACK", apiRecords: 0, fellBackTo };
    }

    // Resolve identity via the dedupe engine and upsert into Fighter/Event/Fight.
    const imported = await persistAggregated(sport, entity, agg.records);

    await finish(sync?.id, startedAt, { status: "SUCCESS", imported, failures, rateLimitHits });
    return { sport, entity, status: "SUCCESS", apiRecords };
  } catch (e) {
    const error = (e as Error).message;
    await finish(sync?.id, startedAt, { status: "FAILED", error });
    log.error({ sport, entity, error }, "sync:failed");
    return { sport, entity, status: "FAILED", apiRecords: 0, error };
  }
}

async function recordHealth(telemetry: SourceTelemetry[]): Promise<void> {
  const touched = telemetry.filter((t) => t.configured);
  if (!touched.length) return;
  await prisma.providerHealth.createMany({
    data: touched.map((t) => ({
      sourceKey: t.source, ok: t.ok, latencyMs: t.latencyMs, rateLimited: t.rateLimited, error: t.error,
    })),
  });
}

async function finish(
  id: string | null | undefined,
  startedAt: Date,
  data: Partial<{ status: string; imported: number; failures: number; rateLimitHits: number; fellBackTo: string; error: string }>,
): Promise<void> {
  if (!id) return; // ProviderSync row wasn't created (table absent) — nothing to update
  const finishedAt = new Date();
  await prisma.providerSync
    .update({
      where: { id },
      data: { ...data, finishedAt, durationMs: finishedAt.getTime() - startedAt.getTime() },
    })
    .catch(() => {});
}

/** Run one entity across many sports, sequentially (gentle on rate limits). */
export async function syncSports(sports: Sport[], entity: SyncEntity): Promise<SyncOutcome[]> {
  const out: SyncOutcome[] = [];
  for (const s of sports) out.push(await syncSportEntity(s, entity));
  return out;
}
