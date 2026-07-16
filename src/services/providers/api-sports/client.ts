// Thin HTTP client for API-Sports MMA (https://v1.mma.api-sports.io).
//
// Direct-access auth uses the `x-apisports-key` header (the key from
// dashboard.api-football.com → MMA). If routed through RapidAPI instead, the
// same key goes in `x-rapidapi-key` with the RapidAPI host header — we support
// both so one env var lights it up either way.
//
// Every endpoint returns the standard API-Sports envelope:
//   { get, parameters, errors, results: <n>, response: [ ... ] }
// The client unwraps `response` and surfaces `errors` as thrown errors so the
// provider never silently treats an auth/quota failure as "no data".

import { fetchJson } from "../http";

const DIRECT_BASE = "https://v1.mma.api-sports.io";
const RAPID_BASE = "https://api-sports-io-mma.p.rapidapi.com";
const RAPID_HOST = "api-sports-io-mma.p.rapidapi.com";

export interface ApiSportsEnvelope<T> {
  get: string;
  parameters: Record<string, string> | unknown[];
  errors: unknown; // [] on success, or { key: "message" } on error
  results: number;
  response: T[];
}

export class ApiSportsRateLimitError extends Error {
  rateLimited = true;
}

export class ApiSportsClient {
  private readonly key: string;
  private readonly viaRapid: boolean;

  /** @param key API-Sports key. @param viaRapid route through RapidAPI host. */
  constructor(key: string, viaRapid = false) {
    this.key = key;
    this.viaRapid = viaRapid;
  }

  private headers(): Record<string, string> {
    return this.viaRapid
      ? { "x-rapidapi-key": this.key, "x-rapidapi-host": RAPID_HOST }
      : { "x-apisports-key": this.key };
  }

  /** GET <endpoint> with query params; returns the unwrapped `response` array. */
  async get<T = Record<string, unknown>>(
    endpoint: string,
    params: Record<string, string | number | undefined> = {},
  ): Promise<T[]> {
    const base = this.viaRapid ? RAPID_BASE : DIRECT_BASE;
    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) {
      if (v !== undefined && v !== "") qs.set(k, String(v));
    }
    const url = `${base}/${endpoint.replace(/^\//, "")}${qs.toString() ? `?${qs}` : ""}`;

    const res = await fetchJson<ApiSportsEnvelope<T>>(url, { headers: this.headers() });

    if (res.rateLimited) {
      throw new ApiSportsRateLimitError("API-Sports rate limit / daily quota reached");
    }
    if (!res.ok || !res.data) {
      throw new Error(`API-Sports ${endpoint} failed: ${res.error ?? `HTTP ${res.status}`}`);
    }
    // API-Sports returns HTTP 200 even for auth/param errors — the `errors`
    // field carries them. Surface as a throw so nothing is silently empty.
    const { errors, response } = res.data;
    const hasErrors = Array.isArray(errors) ? errors.length > 0 : !!errors && Object.keys(errors).length > 0;
    if (hasErrors) {
      throw new Error(`API-Sports ${endpoint} error: ${JSON.stringify(errors)}`);
    }
    return response ?? [];
  }
}
