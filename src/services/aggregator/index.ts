// Aggregation orchestrator. For a sport it queries every *configured* provider
// that covers it, in priority order, then merges their records into one
// canonical set keyed by identity — highest-confidence field wins. Returns the
// merged records plus per-source telemetry the sync layer persists.
//
// With no provider keys present this returns an empty set (every provider
// short-circuits to configured:false) — the machinery is exercised the moment
// a key lands in the environment.

import type { Sport } from "@/lib/types";
import { log } from "@/lib/scraper/logger";
import { PROVIDERS } from "../providers/registry";
import type {
  CombatDataProvider, NormalizedEvent, NormalizedFighter, ProviderResult, FetchOpts, SourceMeta,
} from "../providers/types";
import { apiSourceOrder, sourceConfidence } from "./priority";
import { mergeRecord, type FieldConflict } from "./merge";
import { looseKey, normalizeName } from "../normalization/names";

export interface SourceTelemetry {
  source: string;
  configured: boolean;
  ok: boolean;
  latencyMs: number;
  rateLimited: boolean;
  records: number;
  error?: string;
}

export interface AggregateResult<T> {
  sport: Sport;
  records: T[];
  conflicts: FieldConflict[];
  telemetry: SourceTelemetry[];
}

/** Providers covering `sport`, ordered by the priority engine, configured first. */
function orderedProviders(sport: Sport): CombatDataProvider[] {
  const order = apiSourceOrder(sport);
  return [...PROVIDERS]
    .filter((p) => p.sports.includes(sport))
    .sort((a, b) => order.indexOf(a.key) - order.indexOf(b.key));
}

async function gather<T extends { _meta: SourceMeta }>(
  sport: Sport,
  opts: FetchOpts | undefined,
  call: (p: CombatDataProvider) => Promise<ProviderResult<T>>,
  identity: (r: T) => string,
): Promise<AggregateResult<T>> {
  const providers = orderedProviders(sport);
  const telemetry: SourceTelemetry[] = [];
  const conflicts: FieldConflict[] = [];

  // identity key → { record, perFieldConfidence }
  const canonical = new Map<string, { rec: Record<string, unknown>; conf: Record<string, number> }>();

  for (const p of providers) {
    const res = await call(p);
    telemetry.push({
      source: p.key, configured: res.configured, ok: res.ok,
      latencyMs: res.latencyMs, rateLimited: res.rateLimited, records: res.data.length, error: res.error,
    });
    for (const rec of res.data) {
      // Stamp base confidence from the priority engine if the provider didn't.
      const meta = { ...rec._meta, confidence: rec._meta.confidence || sourceConfidence(sport, p.key) };
      const id = identity(rec);
      const existing = canonical.get(id);
      if (!existing) {
        canonical.set(id, { rec: { ...rec }, conf: fieldConfFor(rec, meta.confidence) });
      } else {
        const merged = mergeRecord(existing.rec, existing.conf, rec as Record<string, unknown>, meta);
        canonical.set(id, { rec: merged.value, conf: merged.fieldConfidence });
        conflicts.push(...merged.conflicts);
      }
    }
  }

  if (conflicts.length) log.warn({ sport, conflicts: conflicts.length }, "aggregator:conflicts");
  return { sport, records: [...canonical.values()].map((v) => v.rec as unknown as T), conflicts, telemetry };
}

function fieldConfFor(rec: Record<string, unknown>, confidence: number): Record<string, number> {
  const out: Record<string, number> = {};
  for (const k of Object.keys(rec)) if (k !== "_meta") out[k] = confidence;
  return out;
}

export function aggregateFighters(sport: Sport, opts?: FetchOpts): Promise<AggregateResult<NormalizedFighter>> {
  return gather<NormalizedFighter>(sport, opts, (p) => p.getFighters({ ...opts, sport }), (r) => `${sport}:${looseKey(r.name)}`);
}

export function aggregateEvents(sport: Sport, opts?: FetchOpts): Promise<AggregateResult<NormalizedEvent>> {
  return gather<NormalizedEvent>(sport, opts, (p) => p.getEvents({ ...opts, sport }), (r) => `${sport}:${normalizeName(r.name)}:${r.date.slice(0, 10)}`);
}
