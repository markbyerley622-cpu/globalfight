// ════════════════════════════════════════════════════════════════════════
//  mmareg (MMA Registry) API client — regional / smaller-promotion coverage.
//
//  Docs: https://apidoc.mmareg.com  ·  Base: https://xapi.mmareg.com
//  Auth: header  X-API-KEY: <key>  (set MMAREG_API_KEY in .env)
//
//  This is the source for SCHEDULED fights across many promotions (UFC, BKFC,
//  Invicta, and regional cards) that the UFC-only Wikipedia roster misses.
// ════════════════════════════════════════════════════════════════════════

import { log } from "@/lib/scraper/logger";

const BASE = process.env.MMAREG_API_BASE ?? "https://xapi.mmareg.com";

export class MmaregConfigError extends Error {}

function apiKey(): string {
  const key = process.env.MMAREG_API_KEY;
  if (!key) throw new MmaregConfigError("MMAREG_API_KEY is not set — add it to .env to enable mmareg.");
  return key;
}

/** Comma-separated promoter ids to pull (MMAREG_PROMOTER_IDS), else []. */
export function promoterIds(): string[] {
  return (process.env.MMAREG_PROMOTER_IDS ?? "").split(",").map((s) => s.trim()).filter(Boolean);
}

async function get<T = unknown>(path: string, params: Record<string, string | string[]> = {}): Promise<T> {
  const url = new URL(path.replace(/^\//, ""), BASE.endsWith("/") ? BASE : `${BASE}/`);
  for (const [k, v] of Object.entries(params)) {
    if (Array.isArray(v)) v.forEach((item) => url.searchParams.append(k, item));
    else if (v) url.searchParams.set(k, v);
  }
  const resp = await fetch(url, { headers: { "X-API-KEY": apiKey(), accept: "application/json" } });
  if (!resp.ok) {
    const body = await resp.text().catch(() => "");
    throw new Error(`mmareg ${resp.status} for ${path}: ${body.slice(0, 200)}`);
  }
  return resp.json() as Promise<T>;
}

/** Upcoming events with full detail (+ bouts) for the configured promoters. */
export function fetchFutureEventsDetailed(opts: { limit?: number; offset?: string } = {}): Promise<unknown> {
  const params: Record<string, string | string[]> = {};
  const ids = promoterIds();
  if (ids.length) params["promoter_ids"] = ids;
  if (opts.limit) params.limit = String(opts.limit);
  if (opts.offset) params.offset = opts.offset;
  log.info({ promoters: ids.length, limit: opts.limit }, "mmareg:future-detailed");
  return get("/events/future/detailed", params);
}

/** All bouts for a single event. */
export function fetchEventBouts(eventId: string): Promise<unknown> {
  return get(`/events/${encodeURIComponent(eventId)}/bouts`);
}

/** Detailed info for a single event (event + related fights). */
export function fetchEventDetailed(eventId: string): Promise<unknown> {
  return get(`/events/${encodeURIComponent(eventId)}/detailed`);
}

export const MMAREG_CONFIGURED = !!process.env.MMAREG_API_KEY;
