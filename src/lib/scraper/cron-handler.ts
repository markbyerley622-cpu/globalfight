import { NextResponse } from "next/server";
import { refreshDetailed, type RefreshKind } from "./runner";
import { isResultTier } from "./wikicard";
import { log } from "./logger";

/**
 * The one auth check every cron route shares. Exported because /api/cron/sync
 * needs it too: it used to roll its own (`x-cron-secret` header, POST only)
 * while every caller sent `Authorization: Bearer` over GET, so it answered 405
 * and never ran once. A second scheme is what let that drift go unnoticed —
 * there should only be this one.
 */
export function cronAuthorized(req: Request): boolean {
  // Accept either our own secret or Vercel Cron's CRON_SECRET (Vercel auto-adds
  // `Authorization: Bearer ${CRON_SECRET}` to scheduled requests), so the
  // vercel.json crons authenticate without extra wiring.
  const secrets = [process.env.SCRAPE_CRON_SECRET, process.env.CRON_SECRET].filter(Boolean);
  if (!secrets.length) return process.env.NODE_ENV !== "production";
  const header = req.headers.get("authorization") ?? "";
  return secrets.some((s) => header === `Bearer ${s}`);
}

/**
 * Builds a GET handler for a cron route that refreshes one entity kind.
 *
 * `?tier=recent|daily|deep` selects the results cadence (see RESULT_TIERS): one
 * route, three schedules. An absent or unrecognised value falls through to the
 * runner's default (`recent`) rather than erroring — a mistyped cron URL should
 * do the cheap, safe thing, not stop results landing altogether.
 */
export function makeCronHandler(kind: RefreshKind) {
  return async function GET(req: Request) {
    if (!cronAuthorized(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const params = new URL(req.url).searchParams;
    const requested = params.get("tier");
    const tier = isResultTier(requested) ? requested : undefined;

    // `?window=fresh` — read only the recently-changed prefix of a promotion
    // sweep, skipping the archive tail. The cheap, frequent job that catches
    // card ANNOUNCEMENTS between the slow twice-weekly archive walks.
    // Anything else (absent, mistyped) means the normal full sweep, so a
    // fat-fingered cron URL does more work rather than silently less.
    const freshOnly = params.get("window") === "fresh";

    const started = Date.now();
    try {
      const { results, failed } = await refreshDetailed(kind, { tier, freshOnly });
      const durationMs = Date.now() - started;

      // A run in which EVERY target threw is a failed run, and must answer with an
      // HTTP error. Previously this returned 200 `ok:true` with the error text
      // hidden inside `results`, so `curl -fsS` in render.yaml saw success and the
      // scheduled job showed green while doing literally nothing. 502 (not 500) so
      // the curl `--retry-all-errors` in the cron services actually retries it.
      const total = Object.keys(results).length;
      if (total > 0 && failed.length === total) {
        log.error({ kind, durationMs, failed }, "cron:all-targets-failed");
        return NextResponse.json(
          { ok: false, kind, durationMs, results, failed, error: failed[0].error },
          { status: 502 },
        );
      }

      // A PARTIAL failure still returns 200 — the run did useful work and retrying
      // it would repeat that work — but `ok` is false and `failed` is populated, so
      // the health dashboard and the logs can both see it.
      if (failed.length) {
        log.warn({ kind, durationMs, failed }, "cron:partial-failure");
        return NextResponse.json({ ok: false, kind, durationMs, results, failed });
      }

      log.info({ kind, tier, durationMs }, "cron:done");
      return NextResponse.json({ ok: true, kind, durationMs, results, failed: [] });
    } catch (e) {
      return NextResponse.json({ ok: false, kind, error: (e as Error).message }, { status: 502 });
    }
  };
}
