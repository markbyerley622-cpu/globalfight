// Sportradar — developer.sportradar.com. Most authoritative for MMA + Boxing.
// Separate entitlement per sport: SPORTRADAR_MMA_KEY and/or SPORTRADAR_BOXING_KEY
// (either alone enables that sport). Reads daily summaries and groups bouts into
// events by promotion + date.
//
// Verify shapes against your entitlement once a key lands (scripts/test-sportradar.ts).
import { BaseProvider } from "../base";
import type { Sport, EventStatus, FightResult } from "@/lib/types";
import type { FetchOpts, ProviderResult, NormalizedEvent, NormalizedFightStub } from "../types";
import { SportradarClient, SR_PRODUCTS, type SrSummary } from "./client";

const SOURCE = "sportradar";
const CONFIDENCE = 0.97; // gold-standard, official feed
// How many days forward/back to pull in one sync (schedule + recent results).
const DAYS_WINDOW = Number(process.env.SPORTRADAR_DAYS ?? 14);

export class SportradarProvider extends BaseProvider {
  readonly key = SOURCE;
  readonly label = "Sportradar";
  readonly sports: readonly Sport[] = ["MMA", "BOXING", "BARE_KNUCKLE"];
  protected readonly envKeys = ["SPORTRADAR_MMA_KEY", "SPORTRADAR_BOXING_KEY"] as const;

  override isConfigured(): boolean {
    return this.envKeys.some((k) => !!process.env[k]?.trim());
  }

  /** Sports actually entitled (key present) intersected with the request. */
  private entitledSports(opts?: FetchOpts): Sport[] {
    const req = opts?.sport ? [opts.sport] : (["MMA", "BOXING"] as Sport[]);
    return req.filter((s) => SR_PRODUCTS[s] && this.env(SR_PRODUCTS[s].envKey));
  }

  async getEvents(opts?: FetchOpts): Promise<ProviderResult<NormalizedEvent>> { return this.feed(opts, false); }
  async getResults(opts?: FetchOpts): Promise<ProviderResult<NormalizedEvent>> { return this.feed(opts, true); }

  private async feed(opts: FetchOpts | undefined, finishedOnly: boolean): Promise<ProviderResult<NormalizedEvent>> {
    const gated = this.gate<NormalizedEvent>();
    if (gated) return gated;
    const started = Date.now();
    try {
      const summaries: (SrSummary & { __sport?: Sport })[] = [];
      for (const sport of this.entitledSports(opts)) {
        const { base, envKey } = SR_PRODUCTS[sport];
        const client = new SportradarClient(base, this.env(envKey));
        for (const date of dateWindow(DAYS_WINDOW)) {
          const day = await client.dailySummaries(date).catch(() => []);
          summaries.push(...day.map((s) => ({ ...s, __sport: sport })));
        }
      }
      const events = groupIntoEvents(summaries, finishedOnly);
      return { configured: true, ok: true, latencyMs: Date.now() - started, rateLimited: false, data: events };
    } catch (e) {
      const err = e as Error & { rateLimited?: boolean };
      return { configured: true, ok: false, latencyMs: Date.now() - started, rateLimited: !!err.rateLimited, error: err.message, data: [] };
    }
  }
}

/** Dates YYYY-MM-DD spanning ±window/2 around today. */
function dateWindow(days: number): string[] {
  const out: string[] = [];
  const now = new Date();
  for (let d = -Math.floor(days / 2); d <= Math.ceil(days / 2); d++) {
    const dt = new Date(now.getTime() + d * 86_400_000);
    out.push(dt.toISOString().slice(0, 10));
  }
  return out;
}

function groupIntoEvents(summaries: (SrSummary & { __sport?: Sport })[], finishedOnly: boolean): NormalizedEvent[] {
  const byKey = new Map<string, { sport: Sport; promotion: string; date: string; fights: NormalizedFightStub[] }>();
  for (const s of summaries) {
    const ev = s.sport_event;
    if (!ev?.start_time) continue;
    const finished = (s.sport_event_status?.status ?? "").toLowerCase() === "closed" || !!s.sport_event_status?.winner_id;
    if (finishedOnly && !finished) continue;
    const promotion = ev.sport_event_context?.competition?.name ?? "MMA";
    const day = ev.start_time.slice(0, 10);
    const key = `${promotion}|${day}`;
    const bucket = byKey.get(key) ?? { sport: s.__sport ?? "MMA", promotion, date: ev.start_time, fights: [] };
    bucket.fights.push(mapFight(s, finished));
    byKey.set(key, bucket);
  }
  const events: NormalizedEvent[] = [];
  for (const [key, v] of byKey) {
    const id = `sportradar-${key}`;
    const status: EventStatus = v.fights.every((f) => f.result !== "SCHEDULED") ? "COMPLETED" : "SCHEDULED";
    events.push({
      externalId: id, name: `${v.promotion} — ${v.date.slice(0, 10)}`, sport: v.sport,
      promotion: v.promotion, date: v.date, status, fights: v.fights,
      _meta: { source: SOURCE, confidence: CONFIDENCE, lastUpdated: new Date().toISOString(), externalId: id },
    });
  }
  return events;
}

function mapFight(s: SrSummary, finished: boolean): NormalizedFightStub {
  const comps = s.sport_event?.competitors ?? [];
  const a = comps[0]; const b = comps[1];
  const winnerId = s.sport_event_status?.winner_id;
  const result: FightResult = !finished ? "SCHEDULED" : winnerId ? "WIN" : "DRAW";
  return {
    redName: a?.name ?? "", blueName: b?.name ?? "",
    redExternalId: a?.id, blueExternalId: b?.id,
    result, winnerExternalId: winnerId,
  };
}
