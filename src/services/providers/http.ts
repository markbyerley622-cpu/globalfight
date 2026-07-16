// Shared HTTP helper for API providers: timeout, exponential backoff with
// jitter, and 429 (rate-limit) detection. Never used for scraping — that path
// keeps living in src/lib/scraper.

export interface HttpResult<T> {
  ok: boolean;
  status: number;
  rateLimited: boolean;
  latencyMs: number;
  data?: T;
  error?: string;
}

export interface HttpOpts {
  headers?: Record<string, string>;
  timeoutMs?: number;
  retries?: number;
  baseDelayMs?: number;
  // Deterministic backoff jitter (0..1); injectable so callers stay testable
  // without Math.random.
  jitter?: number;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** GET + parse JSON with retry/backoff. Resolves (never rejects) to HttpResult. */
export async function fetchJson<T = unknown>(url: string, opts: HttpOpts = {}): Promise<HttpResult<T>> {
  const { headers = {}, timeoutMs = 12_000, retries = 3, baseDelayMs = 500, jitter = 0.5 } = opts;
  const started = Date.now();
  let lastErr = "";
  let lastStatus = 0;

  for (let attempt = 0; attempt <= retries; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(url, { headers: { accept: "application/json", ...headers }, signal: controller.signal });
      clearTimeout(timer);
      lastStatus = res.status;

      if (res.status === 429 || res.status === 503) {
        // Honour Retry-After when present, else exponential backoff.
        const ra = Number(res.headers.get("retry-after"));
        const wait = Number.isFinite(ra) && ra > 0 ? ra * 1000 : backoff(attempt, baseDelayMs, jitter);
        if (attempt < retries) { await sleep(wait); continue; }
        return { ok: false, status: res.status, rateLimited: true, latencyMs: Date.now() - started, error: `rate limited (${res.status})` };
      }

      if (!res.ok) {
        lastErr = `HTTP ${res.status}`;
        // Retry transient 5xx only.
        if (res.status >= 500 && attempt < retries) { await sleep(backoff(attempt, baseDelayMs, jitter)); continue; }
        return { ok: false, status: res.status, rateLimited: false, latencyMs: Date.now() - started, error: lastErr };
      }

      const data = (await res.json()) as T;
      return { ok: true, status: res.status, rateLimited: false, latencyMs: Date.now() - started, data };
    } catch (e) {
      clearTimeout(timer);
      lastErr = (e as Error).name === "AbortError" ? `timeout after ${timeoutMs}ms` : (e as Error).message;
      if (attempt < retries) { await sleep(backoff(attempt, baseDelayMs, jitter)); continue; }
    }
  }
  return { ok: false, status: lastStatus, rateLimited: false, latencyMs: Date.now() - started, error: lastErr || "request failed" };
}

function backoff(attempt: number, base: number, jitter: number): number {
  const exp = base * 2 ** attempt;
  return Math.round(exp * (1 + jitter));
}
