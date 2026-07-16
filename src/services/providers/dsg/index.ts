// Data Sports Group provider — commercial feed for the federation combat sports
// (Taekwondo, Judo, Wrestling) plus Boxing/MMA. Set DSG_API_KEY.
//
// Infrastructure scaffold: gates on the key and calls the documented per-sport
// resources. Response shapes are behind the trial login, so getEvents maps a
// generic {events|results} payload defensively — lock the field names against a
// live response (scripts/test-dsg.ts) when the key arrives.
import { BaseProvider } from "../base";
import type { Sport, EventStatus } from "@/lib/types";
import type { FetchOpts, ProviderResult, NormalizedEvent, NormalizedFightStub } from "../types";
import { DsgClient, DSG_SPORT_PATH } from "./client";

const SOURCE = "dsg";
const CONFIDENCE = 0.85;

interface DsgCompetitor { id?: string | number; name?: string; winner?: boolean }
interface DsgMatch {
  id?: string | number;
  name?: string;
  date?: string;
  start_date?: string;
  weight_class?: string;
  status?: string;
  competitors?: DsgCompetitor[];
  home?: DsgCompetitor;
  away?: DsgCompetitor;
}

export class DsgProvider extends BaseProvider {
  readonly key = SOURCE;
  readonly label = "Data Sports Group";
  readonly sports: readonly Sport[] = ["TAEKWONDO", "JUDO", "WRESTLING", "BOXING", "MMA"];
  protected readonly envKeys = ["DSG_API_KEY"] as const;

  private client(): DsgClient { return new DsgClient(this.env("DSG_API_KEY")); }

  async getEvents(opts?: FetchOpts): Promise<ProviderResult<NormalizedEvent>> { return this.feed(opts, false); }
  async getResults(opts?: FetchOpts): Promise<ProviderResult<NormalizedEvent>> { return this.feed(opts, true); }

  private async feed(opts: FetchOpts | undefined, finishedOnly: boolean): Promise<ProviderResult<NormalizedEvent>> {
    const gated = this.gate<NormalizedEvent>();
    if (gated) return gated;
    const started = Date.now();
    const wanted = opts?.sport ? [opts.sport] : this.sports;
    const client = this.client();
    const data: NormalizedEvent[] = [];
    try {
      for (const sport of wanted) {
        const path = DSG_SPORT_PATH[sport];
        if (!path) continue;
        type DsgPayload = { matches?: DsgMatch[]; events?: DsgMatch[]; results?: DsgMatch[] };
        const payload = await client
          .get<DsgPayload>(`${path}/${finishedOnly ? "results" : "matches"}`)
          .catch((): DsgPayload => ({}));
        const rows = payload.matches ?? payload.events ?? payload.results ?? [];
        for (const m of rows) data.push(mapMatch(m, sport));
      }
      return { configured: true, ok: true, latencyMs: Date.now() - started, rateLimited: false, data };
    } catch (e) {
      const err = e as Error & { rateLimited?: boolean };
      return { configured: true, ok: false, latencyMs: Date.now() - started, rateLimited: !!err.rateLimited, error: err.message, data: [] };
    }
  }
}

function mapMatch(m: DsgMatch, sport: Sport): NormalizedEvent {
  const id = `dsg-${sport.toLowerCase()}-${m.id ?? m.date ?? ""}`;
  const comps = m.competitors ?? [m.home, m.away].filter(Boolean) as DsgCompetitor[];
  const [a, b] = comps;
  const finished = (m.status ?? "").toLowerCase().includes("finish") || comps.some((c) => c.winner);
  const winner = a?.winner ? a : b?.winner ? b : undefined;
  const fight: NormalizedFightStub = {
    redName: a?.name ?? "",
    blueName: b?.name ?? "",
    redExternalId: a?.id != null ? String(a.id) : undefined,
    blueExternalId: b?.id != null ? String(b.id) : undefined,
    weightClass: m.weight_class || undefined,
    result: !finished ? "SCHEDULED" : winner ? "WIN" : "DRAW",
    winnerExternalId: winner?.id != null ? String(winner.id) : undefined,
  };
  const date = m.date ?? m.start_date ?? new Date().toISOString();
  const status: EventStatus = finished ? "COMPLETED" : "SCHEDULED";
  return {
    externalId: id,
    name: m.name ?? `${sport} — ${date.slice(0, 10)}`,
    sport,
    date,
    status,
    fights: [fight],
    _meta: { source: SOURCE, confidence: CONFIDENCE, lastUpdated: new Date().toISOString(), externalId: id },
  };
}
