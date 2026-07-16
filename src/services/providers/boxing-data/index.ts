// Boxing Data API — boxing-data.com / RapidAPI. Best all-round boxing source:
// records, physical stats, titles, future schedules. Set BOXING_DATA_API_KEY.
//
// getEvents() groups the flat fight-schedule feed into events with embedded
// fight stubs. getFighters() walks the same feed for fighter ids and pulls each
// full profile (height/reach/stance/record).
import { BaseProvider } from "../base";
import type { Sport, Stance, EventStatus, FightMethod } from "@/lib/types";
import type { FetchOpts, ProviderResult, NormalizedEvent, NormalizedFighter, NormalizedFightStub } from "../types";
import { BoxingDataClient, type BDFightRow, type BDFighterDetail } from "./client";

const SOURCE = "boxing-data";
const CONFIDENCE = 0.95;
// Quota guard — RapidAPI free tier is ~500 req/month, so keep every sync cheap.
// One full sync ≈ SCHEDULE_PAGES + (up to MAX_FIGHTER_DETAILS) calls. Override
// via env to spend more quota when needed.
const SCHEDULE_PAGES = Number(process.env.BOXING_DATA_MAX_PAGES ?? 3);
const MAX_FIGHTER_DETAILS = Number(process.env.BOXING_DATA_MAX_FIGHTERS ?? 24);

export class BoxingDataProvider extends BaseProvider {
  readonly key = SOURCE;
  readonly label = "Boxing Data API";
  readonly sports: readonly Sport[] = ["BOXING"];
  // Per-provider override OR the shared RapidAPI key (RAPID_API) — every RapidAPI
  // source uses the same x-rapidapi-key, so RAPID_API lights them all up.
  protected readonly envKeys = ["BOXING_DATA_API_KEY"] as const;

  isConfigured(): boolean {
    return !!(this.env("BOXING_DATA_API_KEY") || this.env("RAPID_API"));
  }

  private client(): BoxingDataClient {
    return new BoxingDataClient(this.env("BOXING_DATA_API_KEY") || this.env("RAPID_API"));
  }

  async getEvents(_opts?: FetchOpts): Promise<ProviderResult<NormalizedEvent>> {
    const gated = this.gate<NormalizedEvent>();
    if (gated) return gated;
    const startedAt = Date.now();
    try {
      const rows = await this.client().schedule({ maxPages: SCHEDULE_PAGES });
      const events = groupIntoEvents(rows);
      return { configured: true, ok: true, latencyMs: Date.now() - startedAt, rateLimited: false, data: events };
    } catch (e) {
      return this.fail<NormalizedEvent>(e, startedAt);
    }
  }

  async getFighters(_opts?: FetchOpts): Promise<ProviderResult<NormalizedFighter>> {
    const gated = this.gate<NormalizedFighter>();
    if (gated) return gated;
    const startedAt = Date.now();
    try {
      const client = this.client();
      const rows = await client.schedule({ maxPages: SCHEDULE_PAGES });
      // Unique fighter ids in feed order (most relevant bouts first).
      const ids: string[] = [];
      const seen = new Set<string>();
      for (const r of rows) {
        for (const f of [r.fighters.fighter_1, r.fighters.fighter_2]) {
          if (f?.fighter_id && !seen.has(f.fighter_id)) { seen.add(f.fighter_id); ids.push(f.fighter_id); }
        }
      }
      const data: NormalizedFighter[] = [];
      for (const id of ids.slice(0, MAX_FIGHTER_DETAILS)) {
        const detail = await client.fighter(id).catch(() => null);
        if (detail) data.push(mapFighter(detail));
      }
      return { configured: true, ok: true, latencyMs: Date.now() - startedAt, rateLimited: false, data };
    } catch (e) {
      return this.fail<NormalizedFighter>(e, startedAt);
    }
  }

  private fail<T>(e: unknown, startedAt: number): ProviderResult<T> {
    const err = e as Error & { rateLimited?: boolean };
    return {
      configured: true, ok: false, latencyMs: Date.now() - startedAt,
      rateLimited: !!err.rateLimited, error: err.message, data: [],
    };
  }
}

// ─── mapping helpers ─────────────────────────────────────────────────────

/** "Charleroi, Belgium" → {city:"Charleroi", country:"Belgium"}; last comma-part is the country. */
function parseLocation(loc: string | null): { city?: string; country?: string } {
  if (!loc) return {};
  const parts = loc.split(",").map((p) => p.trim()).filter(Boolean);
  if (parts.length === 0) return {};
  if (parts.length === 1) return { country: parts[0] };
  return { city: parts.slice(0, -1).join(", "), country: parts[parts.length - 1] };
}

function firstBroadcaster(b: Array<Record<string, string>> | null): string | undefined {
  if (!b?.length) return undefined;
  for (const entry of b) {
    const v = Object.values(entry)[0];
    if (v) return v;
  }
  return undefined;
}

function mapStatus(s: string): EventStatus {
  switch (s?.toUpperCase()) {
    case "FINISHED": return "COMPLETED";
    case "LIVE": return "LIVE";
    case "CANCELED":
    case "CANCELLED": return "CANCELLED";
    case "POSTPONED": return "POSTPONED";
    default: return "SCHEDULED";
  }
}

const METHODS: Record<string, FightMethod> = {
  KO: "KO", TKO: "TKO", UD: "UD", SD: "SD", MD: "MD", RTD: "RTD", DQ: "DQ", NC: "NC", DRAW: "DRAW",
};
function mapMethod(outcome: string | null | undefined): FightMethod | undefined {
  if (!outcome) return undefined;
  return METHODS[outcome.toUpperCase()];
}

function mapStance(s: string | null): Stance | undefined {
  switch (s?.toLowerCase()) {
    case "orthodox": return "ORTHODOX";
    case "southpaw": return "SOUTHPAW";
    case "switch": return "SWITCH";
    default: return undefined;
  }
}

function mapFightStub(r: BDFightRow): NormalizedFightStub {
  const f1 = r.fighters.fighter_1;
  const f2 = r.fighters.fighter_2;
  const decided = r.status?.toUpperCase() === "FINISHED";
  return {
    redName: f1.full_name || f1.name,
    blueName: f2.full_name || f2.name,
    redExternalId: f1.fighter_id || undefined,
    blueExternalId: f2.fighter_id || undefined,
    weightClass: r.division?.name ?? undefined,
    scheduledRounds: r.scheduled_rounds ?? undefined,
    titleFight: Array.isArray(r.titles) && r.titles.length > 0,
    mainEvent: (r.card_billing ?? "").toLowerCase().includes("main event"),
    result: decided ? (f1.winner || f2.winner ? "WIN" : "DRAW") : "SCHEDULED",
    method: decided ? mapMethod(r.results?.outcome) : undefined,
    roundEnded: decided ? (r.results?.round ?? undefined) : undefined,
  };
}

/** Collapse the flat per-bout feed into one NormalizedEvent per event id. */
function groupIntoEvents(rows: BDFightRow[]): NormalizedEvent[] {
  const byEvent = new Map<string, { ev: BDFightRow["event"]; rows: BDFightRow[] }>();
  for (const r of rows) {
    const id = r.event?.id ?? r.id;
    const bucket = byEvent.get(id);
    if (bucket) bucket.rows.push(r);
    else byEvent.set(id, { ev: r.event, rows: [r] });
  }

  const out: NormalizedEvent[] = [];
  for (const [eventId, { ev, rows: bouts }] of byEvent) {
    const lead = bouts[0];
    const loc = parseLocation(lead.location ?? ev?.location ?? null);
    out.push({
      externalId: eventId,
      name: ev?.title || lead.title,
      sport: "BOXING",
      promotion: ev?.promotion ?? undefined,
      venue: lead.venue ?? undefined,
      city: loc.city,
      country: loc.country,
      broadcaster: firstBroadcaster(ev?.broadcasters ?? null),
      date: ev?.date || lead.date,
      status: mapStatus(lead.status),
      fights: bouts.map(mapFightStub) as NormalizedFightStub[],
      _meta: {
        source: SOURCE,
        confidence: CONFIDENCE,
        lastUpdated: lead.updated_at ?? ev?.date ?? lead.date,
        externalId: eventId,
      },
    });
  }
  return out;
}

function mapFighter(d: BDFighterDetail): NormalizedFighter {
  return {
    externalId: d.id,
    name: d.name,
    nickname: d.nickname ?? d.alias ?? undefined,
    aliases: d.alias && d.alias !== d.nickname ? [d.alias] : undefined,
    sport: "BOXING",
    nationality: d.nationality ?? undefined,
    countryCode: d.nationality_code ?? undefined,
    heightCm: d.height_cm ?? undefined,
    reachCm: d.reach_cm ?? undefined,
    stance: mapStance(d.stance),
    wins: d.stats?.wins,
    losses: d.stats?.losses,
    draws: d.stats?.draws,
    _meta: {
      source: SOURCE,
      confidence: CONFIDENCE,
      lastUpdated: d.updated_at ?? new Date(0).toISOString(),
      externalId: d.id,
    },
  };
}
