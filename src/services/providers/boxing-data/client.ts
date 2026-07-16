// Thin typed client for the Boxing Data API (boxing-data-api.p.rapidapi.com via
// RapidAPI). Only the endpoints we consume are modelled. Every call is plain
// fetch — the caller wraps it in the ProviderResult envelope and applies the
// configured/rate-limit gating.

const HOST = "boxing-data-api.p.rapidapi.com";
const BASE = `https://${HOST}`;

export interface BDFighterRef {
  fighter_id: string;
  name: string;
  full_name: string;
  winner: boolean;
}

export interface BDDivision {
  id: string;
  name: string;
  weight_lb: number | null;
  weight_kg: number | null;
}

export interface BDEvent {
  id: string;
  title: string;
  slug: string | null;
  date: string;
  location: string | null;
  broadcasters: Array<Record<string, string>> | null;
  promotion: string | null;
  co_promotion: string | null;
  poster_image_url: string | null;
}

export interface BDFightRow {
  id: string;
  title: string;
  date: string;
  venue: string | null;
  location: string | null;
  results: { outcome: string | null; outcome_long: string | null; round: number | null } | null;
  scheduled_rounds: number | null;
  card_billing: string | null;
  status: string; // NOT_STARTED | FINISHED | LIVE | CANCELED ...
  fighters: { fighter_1: BDFighterRef; fighter_2: BDFighterRef };
  event: BDEvent;
  division: BDDivision | null;
  titles: unknown[];
  updated_at: string | null;
}

export interface BDFighterDetail {
  id: string;
  name: string;
  alias: string | null;
  gender: string | null;
  age: number | null;
  height_cm: number | null;
  reach_cm: number | null;
  nationality: string | null;
  nationality_code: string | null;
  nickname: string | null;
  stance: string | null;
  stats: { wins: number; losses: number; draws: number; total_bouts?: number; total_rounds: number } | null;
  debut: string | null;
  division?: { id: string; name: string; weight_lb: number | null; weight_kg: number | null } | null;
  updated_at: string | null;
}

interface BDEnvelope<T> {
  pagination?: { page: number; items: number; total_pages: number; total_items: number };
  error?: { code?: string; message?: string } | Record<string, never>;
  data: T;
}

export class BoxingDataClient {
  constructor(private readonly apiKey: string) {}

  private headers(): Record<string, string> {
    return {
      "x-rapidapi-host": HOST,
      "x-rapidapi-key": this.apiKey,
      "Content-Type": "application/json",
    };
  }

  private async get<T>(path: string): Promise<BDEnvelope<T>> {
    const res = await fetch(`${BASE}${path}`, { headers: this.headers() });
    if (res.status === 429) {
      const e = new Error("rate-limited") as Error & { rateLimited?: boolean };
      e.rateLimited = true;
      throw e;
    }
    const body = (await res.json().catch(() => ({}))) as BDEnvelope<T>;
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${body?.error?.message ?? res.statusText}`);
    return body;
  }

  /**
   * Page through the upcoming/recent fight schedule. The feed returns one row
   * per bout with its event + fighters + division embedded. `maxPages` bounds
   * the crawl so a sync stays within the RapidAPI quota.
   */
  async schedule(opts: { pageSize?: number; maxPages?: number } = {}): Promise<BDFightRow[]> {
    const pageSize = opts.pageSize ?? 25;
    const maxPages = opts.maxPages ?? 6;
    const rows: BDFightRow[] = [];
    for (let page = 1; page <= maxPages; page++) {
      const env = await this.get<BDFightRow[]>(
        `/v2/fights/schedule/?date_sort=ASC&page_num=${page}&page_size=${pageSize}`,
      );
      const batch = env.data ?? [];
      rows.push(...batch);
      const totalPages = env.pagination?.total_pages ?? 1;
      if (page >= totalPages || batch.length === 0) break;
    }
    return rows;
  }

  /** Full per-fighter profile (height/reach/stance/record). */
  async fighter(id: string): Promise<BDFighterDetail | null> {
    const env = await this.get<BDFighterDetail | null>(`/v2/fighters/${id}`);
    return env.data ?? null;
  }

  /** Search fighters by name — one request, used to enrich existing DB rows. */
  async searchFighters(name: string, pageSize = 5): Promise<BDFighterDetail[]> {
    const env = await this.get<BDFighterDetail[]>(
      `/v2/fighters/?name=${encodeURIComponent(name)}&page_size=${pageSize}`,
    );
    return Array.isArray(env.data) ? env.data : [];
  }
}
