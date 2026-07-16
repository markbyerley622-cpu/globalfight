// FightAnalytics client — TWO APIs, both bearer-JWT (fightanalytics.cc).
//   META  = api.fightanalytics.cc            — catalogue: fighters, fights, events…
//   LIVE  = mike-goldberg-v2.fightanalytics.cc — DEEP per-round telemetry
//
// Auth: Authorization: Bearer <FIGHTANALYTICS_TOKEN>. The login endpoint is not
// in either Swagger spec (generate the token per the vendor's instructions).
//
// Field shapes below are taken verbatim from the published OpenAPI (Swagger) —
// verify against a live response once a token is set (scripts/test-fightanalytics.ts).
import { fetchJson } from "../http";

const META = process.env.FIGHTANALYTICS_META_BASE ?? "https://api.fightanalytics.cc";
const LIVE = process.env.FIGHTANALYTICS_LIVE_BASE ?? "https://mike-goldberg-v2.fightanalytics.cc";
// Auth lives on a separate host (discovered from the admin portal). The data
// APIs take the accessToken this returns as their bearer.
const AUTH = process.env.FIGHTANALYTICS_AUTH_BASE ?? "https://auth-api.fightanalytics.cc";

export interface FaCredentials { token?: string; username?: string; password?: string }

// Module-level token cache so we log in once, not per request.
let cachedToken: string | null = null;

interface LoginResponse { accessToken?: string; access_token?: string; token?: string; refreshToken?: string }

// ── META-DATA API shapes (catalogue) ──────────────────────────────────────
export type FaSport = "MMA" | "BOXING" | "KICKBOXING" | "MUAY_THAI" | "WRESTLING" | "SUBMISSION" | "SUBMISSION_GRAPPLING";

export interface FaFighter {
  id: string; firstName?: string; lastName?: string; nickname?: string;
  sport?: FaSport; profileImageUrl?: string; dateOfBirth?: string; age?: number;
  height?: number; weight?: number; reach?: number;
  wins?: number; losses?: number; draws?: number;
  winsKoTko?: number; winsSubmission?: number; winsDecision?: number;
  lossesKoTko?: number; lossesSubmission?: number; lossesDecision?: number;
  country?: string; fightingOut?: string; weightClass?: string; gender?: string;
  teamId?: string; promotionId?: string;
}
export interface FaFight {
  id: string; eventId?: string; redCornerId?: string; blueCornerId?: string;
  order?: number; totalRound?: number; roundTime?: number; sport?: FaSport;
  weightClass?: string; winner?: string; finishedAt?: string; finishedAtRound?: number; result?: string;
}
export interface FaEvent {
  id: string; name?: string; time?: string; location?: string;
  venueId?: string; promotionId?: string; date?: string; country?: string;
}

// ── LIVE-DATA API shapes (deep stats) — the FightAnalytics moat ────────────
export interface FaStanceStats {
  score?: number; totalStrikes?: number; significantStrikes?: number;
  significantStrikesHead?: number; significantStrikesBody?: number; significantStrikesLegs?: number;
  takedowns?: number; takedownAttempts?: number; takedownsDefended?: number;
  submissionAttempts?: number; knockdowns?: number; elapsedControlTime?: number;
  reversals?: number; transitions?: number; escapes?: number; advantages?: number;
  nearFalls?: number; exposures?: number; falls?: number; pinnings?: number; backtakes?: number;
}
export interface FaFighterStats {
  wins?: number; draws?: number; losses?: number; score?: number;
  elapsedFightTime?: number; totalRounds?: number;
  standing?: FaStanceStats; ground?: FaStanceStats; fence?: FaStanceStats; riding?: FaStanceStats;
}

interface Paginated<T> { data?: T[]; items?: T[]; results?: T[] }

export class FightAnalyticsClient {
  constructor(private readonly creds: FaCredentials) {}

  /** POST auth-api/auth/login with username+password → accessToken (cached). */
  private async login(): Promise<string> {
    if (this.creds.token) return this.creds.token; // static token wins
    const { username, password } = this.creds;
    if (!username || !password) throw new Error("FightAnalytics: set FIGHTANALYTICS_TOKEN, or FIGHTANALYTICS_USER + FIGHTANALYTICS_PASSWORD");
    const resp = await fetch(`${AUTH}/auth/login`, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify({ username, password }),
    });
    if (!resp.ok) throw new Error(`FightAnalytics login failed: HTTP ${resp.status}`);
    const body = (await resp.json()) as LoginResponse;
    const tok = body.accessToken ?? body.access_token ?? body.token;
    if (!tok) throw new Error("FightAnalytics login: no token in response");
    cachedToken = tok;
    return tok;
  }

  private async token(): Promise<string> {
    return this.creds.token ?? cachedToken ?? (await this.login());
  }

  private async get<T>(base: string, path: string, params: Record<string, string | number | undefined> = {}): Promise<T> {
    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== "") qs.set(k, String(v));
    const url = `${base}/${path.replace(/^\//, "")}${qs.toString() ? `?${qs}` : ""}`;
    let tok = await this.token();
    let res = await fetchJson<T>(url, { headers: { authorization: `Bearer ${tok}` } });
    // token expired → re-login once, retry.
    if ((res.status === 401 || res.status === 403) && !this.creds.token) {
      cachedToken = null;
      tok = await this.login();
      res = await fetchJson<T>(url, { headers: { authorization: `Bearer ${tok}` } });
    }
    if (res.rateLimited) throw Object.assign(new Error("FightAnalytics rate limit"), { rateLimited: true });
    if (res.status === 401 || res.status === 403) throw new Error("FightAnalytics auth failed — check credentials");
    if (!res.ok || res.data === undefined) throw new Error(`FightAnalytics ${path} failed: ${res.error ?? res.status}`);
    return res.data;
  }

  /** Unwrap a paginated list into a plain array (tolerant of data|items|results). */
  private list<T>(p: Paginated<T> | T[]): T[] {
    if (Array.isArray(p)) return p;
    return p.data ?? p.items ?? p.results ?? [];
  }

  // META catalogue
  async fighters(page = 1, limit = 50): Promise<FaFighter[]> {
    return this.list(await this.get<Paginated<FaFighter>>(META, "fighters", { page, limit }));
  }
  async fights(page = 1, limit = 50): Promise<FaFight[]> {
    return this.list(await this.get<Paginated<FaFight>>(META, "fights", { page, limit }));
  }
  async events(page = 1, limit = 50): Promise<FaEvent[]> {
    return this.list(await this.get<Paginated<FaEvent>>(META, "events", { page, limit }));
  }

  // LIVE deep stats (per fight / fighter)
  fightTotals(fightId: string): Promise<FaFighterStats[]> {
    return this.get<FaFighterStats[]>(LIVE, `fights/${fightId}/totals`);
  }
  fightRounds(fightId: string): Promise<unknown> {
    return this.get<unknown>(LIVE, `fights/${fightId}/rounds`);
  }
  fighterCareer(fighterId: string): Promise<unknown> {
    return this.get<unknown>(LIVE, `fighters/${fighterId}/career`);
  }
}
