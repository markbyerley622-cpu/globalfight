// Data Sports Group (dsg-api.com). Commercial multi-sport feed — the one API
// that covers the FEDERATION combat sports (Taekwondo, Judo, Wrestling, Karate)
// plus Boxing/MMA. Auth: api key. Quote-only pricing (free trial).
//
// Endpoint paths follow dsg-api.com/doc/<sport>/... The exact JSON shapes are
// behind the trial login, so map defensively and verify with a live call once a
// key lands (scripts/test-dsg.ts). The client throws on transport errors so a
// bad key never looks like "no data".
import { fetchJson } from "../http";

const BASE = process.env.DSG_API_BASE ?? "https://dsg-api.com/api";

export class DsgClient {
  constructor(private readonly key: string) {}

  /** GET <sport>/<resource> with the api key. Returns the raw JSON payload. */
  async get<T = unknown>(path: string, params: Record<string, string | number | undefined> = {}): Promise<T> {
    const qs = new URLSearchParams({ api_key: this.key });
    for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== "") qs.set(k, String(v));
    const url = `${BASE}/${path.replace(/^\//, "")}?${qs}`;
    const res = await fetchJson<T>(url, { headers: { "X-API-Key": this.key } });
    if (res.rateLimited) throw Object.assign(new Error("DSG rate limit"), { rateLimited: true });
    if (!res.ok || res.data === undefined) throw new Error(`DSG ${path} failed: ${res.error ?? res.status}`);
    return res.data;
  }
}

// DSG sport slugs (their coverage paths) → our Sport enum.
export const DSG_SPORT_PATH: Record<string, string> = {
  TAEKWONDO: "taekwondo",
  JUDO: "judo",
  WRESTLING: "wrestling",
  BOXING: "boxing",
  MMA: "mma",
};
