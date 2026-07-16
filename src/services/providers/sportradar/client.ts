// Sportradar Combat Sports (MMA v2 / Boxing v2). Enterprise feed, separate key
// + entitlement per sport. Auth: api_key query param. JSON via the `.json`
// suffix. We read daily summaries (schedule + results + statistics for a day).
//
// Access level ("trial" | "production") from SPORTRADAR_ACCESS (default trial).
// Verify exact shapes against your entitlement's docs / a live call.
import { fetchJson } from "../http";

const ACCESS = process.env.SPORTRADAR_ACCESS ?? "trial";

// Per-sport product base path + the env var holding its key.
export const SR_PRODUCTS: Record<string, { base: string; envKey: string }> = {
  MMA: { base: `https://api.sportradar.com/mma/${ACCESS}/v2/en`, envKey: "SPORTRADAR_MMA_KEY" },
  BOXING: { base: `https://api.sportradar.com/boxing/${ACCESS}/v2/en`, envKey: "SPORTRADAR_BOXING_KEY" },
};

export interface SrCompetitor {
  id?: string; name?: string; qualifier?: string; country?: string; country_code?: string;
}
export interface SrSummary {
  sport_event?: {
    id?: string;
    start_time?: string;
    competitors?: SrCompetitor[];
    sport_event_context?: { competition?: { name?: string }; category?: { name?: string } };
    venue?: { name?: string; city_name?: string; country_name?: string; country_code?: string };
  };
  sport_event_status?: { status?: string; match_status?: string; winner_id?: string };
}
interface SrDailySummaries { summaries?: SrSummary[] }

export class SportradarClient {
  constructor(private readonly base: string, private readonly key: string) {}

  /** Daily summaries for YYYY-MM-DD. */
  async dailySummaries(date: string): Promise<SrSummary[]> {
    const url = `${this.base}/schedules/${date}/summaries.json?api_key=${encodeURIComponent(this.key)}`;
    const res = await fetchJson<SrDailySummaries>(url);
    if (res.rateLimited) throw Object.assign(new Error("Sportradar rate limit"), { rateLimited: true });
    if (!res.ok || !res.data) throw new Error(`Sportradar summaries failed: ${res.error ?? res.status}`);
    return res.data.summaries ?? [];
  }
}
