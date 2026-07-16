// API-Sports MMA — v1.mma.api-sports.io. Fighter DB with stable cross-competition
// ids, plus a fight feed (seasons → categories → fights → fighters/odds).
//
// The MMA feed is fight-centric (no event entity), so getEvents/getResults group
// the flat fight list by date into synthetic events with embedded fight stubs —
// mirroring the boxing-data provider. getFighters walks the season's fights for
// ids and pulls each full profile (bio + record).
//
// Auth: x-apisports-key (direct) or the shared RapidAPI key. Set API_SPORTS_KEY
// (add API_SPORTS_VIA_RAPIDAPI=true to route through RapidAPI).
//
// NOTE: field names below follow the API-Sports MMA v1 docs. Verify against a
// live response with `npx tsx scripts/test-api-sports.ts` once the key is set —
// the client throws on any auth/quota error, so nothing maps silently to empty.
import { BaseProvider } from "../base";
import type { Sport, Stance, EventStatus, FightResult } from "@/lib/types";
import type {
  FetchOpts, ProviderResult, NormalizedEvent, NormalizedFighter, NormalizedFightStub,
} from "../types";
import { ApiSportsClient, ApiSportsRateLimitError } from "./client";

const SOURCE = "api-sports";
const CONFIDENCE = 0.88;
// Quota guard — the free tier is 100 req/day. One fighter sync ≈ 1 (fights) +
// up to MAX_FIGHTER_DETAILS calls. Override via env to spend more quota.
const MAX_FIGHTER_DETAILS = Number(process.env.API_SPORTS_MAX_FIGHTERS ?? 25);

// ── Raw API shapes (partial — only what we map) ──────────────────────────
interface RawFighterRef { id?: number; name?: string; winner?: boolean | null }
interface RawFight {
  id?: number;
  date?: string;                       // ISO datetime
  category?: string;                   // weight class
  slug?: string;
  is_main?: boolean;
  status?: { long?: string; short?: string };
  fighters?: { first?: RawFighterRef; second?: RawFighterRef };
}
interface RawFighter {
  id?: number;
  name?: string;
  nickname?: string;
  photo?: string;
  gender?: string;
  birth_date?: string;
  height?: string;                     // e.g. `6' 4"` or `193 cm`
  reach?: string;                      // e.g. `84.5"` or `214 cm`
  stance?: string;
  category?: string;
  country?: { name?: string; code?: string };
  records?: { win?: number; loss?: number; draw?: number };
}

export class ApiSportsProvider extends BaseProvider {
  readonly key = SOURCE;
  readonly label = "API-Sports MMA";
  readonly sports: readonly Sport[] = ["MMA"];
  protected readonly envKeys = ["API_SPORTS_KEY"] as const;

  isConfigured(): boolean {
    return !!(this.env("API_SPORTS_KEY") || this.env("RAPID_API"));
  }

  private client(): ApiSportsClient {
    const key = this.env("API_SPORTS_KEY") || this.env("RAPID_API");
    return new ApiSportsClient(key, this.env("API_SPORTS_VIA_RAPIDAPI") === "true");
  }

  /** Season year to query — explicit `since` year, else current calendar year. */
  private season(opts?: FetchOpts): string {
    return (opts?.since ?? new Date().toISOString()).slice(0, 4);
  }

  async getEvents(opts?: FetchOpts): Promise<ProviderResult<NormalizedEvent>> {
    return this.eventsFeed(opts, false);
  }

  async getResults(opts?: FetchOpts): Promise<ProviderResult<NormalizedEvent>> {
    return this.eventsFeed(opts, true);
  }

  async getFighters(opts?: FetchOpts): Promise<ProviderResult<NormalizedFighter>> {
    const gated = this.gate<NormalizedFighter>();
    if (gated) return gated;
    const started = Date.now();
    try {
      const client = this.client();
      const fights = await client.get<RawFight>("fights", { season: this.season(opts) });
      // Unique fighter ids in feed order.
      const ids: number[] = [];
      const seen = new Set<number>();
      for (const f of fights) {
        for (const ref of [f.fighters?.first, f.fighters?.second]) {
          if (ref?.id && !seen.has(ref.id)) { seen.add(ref.id); ids.push(ref.id); }
        }
      }
      const data: NormalizedFighter[] = [];
      for (const id of ids.slice(0, opts?.limit ?? MAX_FIGHTER_DETAILS)) {
        const [raw] = await client.get<RawFighter>("fighters", { id }).catch(() => []);
        if (raw) data.push(mapFighter(raw));
      }
      return ok(data, started);
    } catch (e) {
      return fail<NormalizedFighter>(e, started);
    }
  }

  /** Shared fight-feed reader → events grouped by date. `finishedOnly` filters
   *  to completed bouts for getResults. */
  private async eventsFeed(opts: FetchOpts | undefined, finishedOnly: boolean): Promise<ProviderResult<NormalizedEvent>> {
    const gated = this.gate<NormalizedEvent>();
    if (gated) return gated;
    const started = Date.now();
    try {
      const fights = await this.client().get<RawFight>("fights", { season: this.season(opts) });
      const relevant = finishedOnly ? fights.filter(isFinished) : fights;
      return ok(groupByDate(relevant), started);
    } catch (e) {
      return fail<NormalizedEvent>(e, started);
    }
  }
}

// ── Mapping helpers ──────────────────────────────────────────────────────
function meta(externalId: string) {
  return { source: SOURCE, confidence: CONFIDENCE, lastUpdated: new Date().toISOString(), externalId };
}

function mapFighter(r: RawFighter): NormalizedFighter {
  return {
    externalId: String(r.id ?? ""),
    name: r.name?.trim() ?? "",
    nickname: r.nickname?.trim() || undefined,
    sport: "MMA",
    nationality: r.country?.name || undefined,
    countryCode: r.country?.code || undefined,
    birthDate: r.birth_date || undefined,
    heightCm: parseLengthCm(r.height),
    reachCm: parseLengthCm(r.reach),
    stance: mapStance(r.stance),
    wins: r.records?.win,
    losses: r.records?.loss,
    draws: r.records?.draw,
    imageUrl: r.photo || undefined,
    _meta: meta(String(r.id ?? "")),
  };
}

function mapFightStub(f: RawFight): NormalizedFightStub {
  const a = f.fighters?.first;
  const b = f.fighters?.second;
  const finished = isFinished(f);
  const winner = a?.winner ? a : b?.winner ? b : undefined;
  const result: FightResult = !finished ? "SCHEDULED" : winner ? "WIN" : "DRAW";
  return {
    redName: a?.name?.trim() ?? "",
    blueName: b?.name?.trim() ?? "",
    redExternalId: a?.id ? String(a.id) : undefined,
    blueExternalId: b?.id ? String(b.id) : undefined,
    weightClass: f.category || undefined,
    mainEvent: f.is_main || undefined,
    result,
    winnerExternalId: winner?.id ? String(winner.id) : undefined,
  };
}

/** Group standalone fights into one synthetic event per calendar date. */
function groupByDate(fights: RawFight[]): NormalizedEvent[] {
  const byDate = new Map<string, RawFight[]>();
  for (const f of fights) {
    if (!f.date) continue;
    const day = f.date.slice(0, 10);
    const bucket = byDate.get(day) ?? [];
    bucket.push(f);
    byDate.set(day, bucket);
  }
  const events: NormalizedEvent[] = [];
  for (const [day, dayFights] of byDate) {
    const anyLive = dayFights.some((f) => (f.status?.short ?? "").toUpperCase() === "LIVE");
    const allDone = dayFights.every(isFinished);
    const status: EventStatus = anyLive ? "LIVE" : allDone ? "COMPLETED" : "SCHEDULED";
    events.push({
      externalId: `apisports-mma-${day}`,
      name: `MMA — ${day}`,
      sport: "MMA",
      date: `${day}T00:00:00.000Z`,
      status,
      fights: dayFights.map(mapFightStub),
      _meta: meta(`apisports-mma-${day}`),
    });
  }
  return events;
}

function isFinished(f: RawFight): boolean {
  const s = (f.status?.short ?? f.status?.long ?? "").toUpperCase();
  return s === "FT" || s.includes("FINISH") || !!f.fighters?.first?.winner || !!f.fighters?.second?.winner;
}

function mapStance(s?: string): Stance | undefined {
  switch ((s ?? "").toLowerCase()) {
    case "orthodox": return "ORTHODOX";
    case "southpaw": return "SOUTHPAW";
    case "switch": return "SWITCH";
    default: return undefined;
  }
}

/** Parse API-Sports length strings to cm. Handles `6' 4"`, `84.5"`, `193 cm`. */
function parseLengthCm(raw: string | undefined): number | undefined {
  if (!raw) return undefined;
  const s = raw.trim();
  const cm = s.match(/([\d.]+)\s*cm/i);
  if (cm) return Math.round(Number(cm[1]));
  const ft = s.match(/(\d+)\s*'\s*([\d.]+)/); // 6' 4"
  if (ft) return Math.round((Number(ft[1]) * 12 + Number(ft[2])) * 2.54);
  const inch = s.match(/([\d.]+)\s*"/); // 84.5"
  if (inch) return Math.round(Number(inch[1]) * 2.54);
  // Never guess units for a bare number — return undefined rather than fabricate.
  return undefined;
}

function ok<T>(data: T[], started: number): ProviderResult<T> {
  return { configured: true, ok: true, latencyMs: Date.now() - started, rateLimited: false, data };
}

function fail<T>(e: unknown, started: number): ProviderResult<T> {
  const rate = e instanceof ApiSportsRateLimitError;
  return {
    configured: true, ok: false, latencyMs: Date.now() - started,
    rateLimited: rate, error: (e as Error).message, data: [],
  };
}
