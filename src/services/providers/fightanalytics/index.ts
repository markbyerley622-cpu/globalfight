// Fight Analytics — fightanalytics.cc (TWO bearer-JWT APIs: catalogue + deep stats).
//
// Coverage (from their Swagger `sport` enum): MMA, Boxing, Kickboxing, Muay Thai,
// Wrestling, Submission, Submission Grappling — mapped to our Sport enum below.
//
// Uniquely provides DEEP per-round telemetry segmented by position
// (standing / ground / fence / riding): significant strikes by target, takedowns
// (att/landed/defended), submission attempts, knockdowns, control time, plus
// wrestling metrics (near-falls, pinnings, reversals, back-takes…). See the
// Live-Data endpoints in client.ts — that data is the reason FA is €22k/yr.
//
// Set FIGHTANALYTICS_TOKEN (bearer JWT) to activate. getEvents/getResults/getFighters
// read the Meta catalogue; the deep-stats endpoints are exposed on the client for a
// future fight-detail model. Verify field shapes with scripts/test-fightanalytics.ts.
import { BaseProvider } from "../base";
import type { Sport, FightResult } from "@/lib/types";
import type { FetchOpts, ProviderResult, NormalizedEvent, NormalizedFighter, NormalizedFightStub } from "../types";
import { FightAnalyticsClient, type FaFighter, type FaFight, type FaEvent, type FaSport } from "./client";

const SOURCE = "fightanalytics";
const CONFIDENCE = 0.9; // human-tagged, deepest stats — high once verified
const MAX_PAGES = Number(process.env.FIGHTANALYTICS_MAX_PAGES ?? 3);
const PAGE_SIZE = Number(process.env.FIGHTANALYTICS_PAGE_SIZE ?? 50);

export class FightAnalyticsProvider extends BaseProvider {
  readonly key = SOURCE;
  readonly label = "Fight Analytics";
  readonly sports: readonly Sport[] = ["MMA", "BOXING", "KICKBOXING", "MUAY_THAI", "WRESTLING", "BJJ", "BJJ_NOGI"];
  protected readonly envKeys = ["FIGHTANALYTICS_TOKEN"] as const;

  // Configured with EITHER a static token OR username+password (the client logs
  // in against auth-api.fightanalytics.cc and refreshes its own token).
  override isConfigured(): boolean {
    return !!(this.env("FIGHTANALYTICS_TOKEN") || (this.env("FIGHTANALYTICS_USER") && this.env("FIGHTANALYTICS_PASSWORD")));
  }

  private client(): FightAnalyticsClient {
    return new FightAnalyticsClient({
      token: this.env("FIGHTANALYTICS_TOKEN") || undefined,
      username: this.env("FIGHTANALYTICS_USER") || undefined,
      password: this.env("FIGHTANALYTICS_PASSWORD") || undefined,
    });
  }

  async getFighters(opts?: FetchOpts): Promise<ProviderResult<NormalizedFighter>> {
    const gated = this.gate<NormalizedFighter>();
    if (gated) return gated;
    const started = Date.now();
    try {
      const client = this.client();
      const data: NormalizedFighter[] = [];
      for (let page = 1; page <= MAX_PAGES; page++) {
        const rows = await client.fighters(page, opts?.limit ?? PAGE_SIZE);
        if (!rows.length) break;
        data.push(...rows.map(mapFighter));
      }
      return ok(data, started);
    } catch (e) { return fail<NormalizedFighter>(e, started); }
  }

  async getEvents(opts?: FetchOpts): Promise<ProviderResult<NormalizedEvent>> { return this.feed(opts, false); }
  async getResults(opts?: FetchOpts): Promise<ProviderResult<NormalizedEvent>> { return this.feed(opts, true); }

  /** Meta events + fights → events with embedded fight stubs (grouped by eventId). */
  private async feed(opts: FetchOpts | undefined, finishedOnly: boolean): Promise<ProviderResult<NormalizedEvent>> {
    const gated = this.gate<NormalizedEvent>();
    if (gated) return gated;
    const started = Date.now();
    try {
      const client = this.client();
      const events: FaEvent[] = [];
      const fights: FaFight[] = [];
      for (let page = 1; page <= MAX_PAGES; page++) {
        const e = await client.events(page, PAGE_SIZE); if (e.length) events.push(...e);
        const f = await client.fights(page, PAGE_SIZE); if (f.length) fights.push(...f);
        if (!e.length && !f.length) break;
      }
      const byEvent = new Map<string, FaFight[]>();
      for (const f of fights) {
        if (finishedOnly && !isFinished(f)) continue;
        const key = f.eventId ?? "unassigned";
        (byEvent.get(key) ?? byEvent.set(key, []).get(key)!).push(f);
      }
      const data = events.map((e) => mapEvent(e, byEvent.get(e.id) ?? []));
      return ok(data, started);
    } catch (e) { return fail<NormalizedEvent>(e, started); }
  }
}

// ── mapping ────────────────────────────────────────────────────────────────
const SPORT_MAP: Record<FaSport, Sport> = {
  MMA: "MMA", BOXING: "BOXING", KICKBOXING: "KICKBOXING", MUAY_THAI: "MUAY_THAI",
  WRESTLING: "WRESTLING", SUBMISSION: "BJJ", SUBMISSION_GRAPPLING: "BJJ_NOGI",
};
const mapSport = (s?: FaSport): Sport => (s ? SPORT_MAP[s] ?? "MMA" : "MMA");
const titleCase = (w?: string) => w ? w.toLowerCase().replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()) : undefined;
const meta = (id: string) => ({ source: SOURCE, confidence: CONFIDENCE, lastUpdated: new Date().toISOString(), externalId: id });

function mapFighter(f: FaFighter): NormalizedFighter {
  const name = [f.firstName, f.lastName].filter(Boolean).join(" ").trim();
  return {
    externalId: f.id,
    name,
    nickname: f.nickname || undefined,
    sport: mapSport(f.sport),
    nationality: f.country || undefined,
    birthDate: f.dateOfBirth || undefined,
    heightCm: f.height || undefined,
    reachCm: f.reach || undefined,
    wins: f.wins, losses: f.losses, draws: f.draws,
    koWins: f.winsKoTko,
    imageUrl: f.profileImageUrl || undefined,
    _meta: meta(f.id),
  };
}

function isFinished(f: FaFight): boolean {
  return !!f.finishedAt || !!f.winner || !!f.result;
}

function mapFightStub(f: FaFight): NormalizedFightStub {
  const finished = isFinished(f);
  const winnerIsRed = f.winner && f.winner === f.redCornerId;
  const winnerIsBlue = f.winner && f.winner === f.blueCornerId;
  const result: FightResult = !finished ? "SCHEDULED" : (winnerIsRed || winnerIsBlue) ? "WIN" : "DRAW";
  return {
    redName: "", blueName: "", // names resolved via fighter ids downstream
    redExternalId: f.redCornerId || undefined,
    blueExternalId: f.blueCornerId || undefined,
    weightClass: titleCase(f.weightClass),
    scheduledRounds: f.totalRound,
    roundEnded: f.finishedAtRound,
    result,
    winnerExternalId: f.winner || undefined,
  };
}

function mapEvent(e: FaEvent, fights: FaFight[]): NormalizedEvent {
  const sport = mapSport(fights[0]?.sport);
  const allDone = fights.length > 0 && fights.every(isFinished);
  return {
    externalId: e.id,
    name: e.name ?? `FightAnalytics event ${e.id}`,
    sport,
    date: e.date ?? e.time ?? new Date().toISOString(),
    country: e.country || undefined,
    status: allDone ? "COMPLETED" : "SCHEDULED",
    fights: fights.map(mapFightStub),
    _meta: meta(e.id),
  };
}

function ok<T>(data: T[], started: number): ProviderResult<T> {
  return { configured: true, ok: true, latencyMs: Date.now() - started, rateLimited: false, data };
}
function fail<T>(e: unknown, started: number): ProviderResult<T> {
  const err = e as Error & { rateLimited?: boolean };
  return { configured: true, ok: false, latencyMs: Date.now() - started, rateLimited: !!err.rateLimited, error: err.message, data: [] };
}
