import { NextResponse } from "next/server";
import { refresh, type RefreshKind } from "./runner";
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

/** Builds a GET handler for a cron route that refreshes one entity kind. */
export function makeCronHandler(kind: RefreshKind) {
  return async function GET(req: Request) {
    if (!cronAuthorized(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const started = Date.now();
    try {
      const results = await refresh(kind);
      const durationMs = Date.now() - started;
      log.info({ kind, durationMs }, "cron:done");
      return NextResponse.json({ ok: true, kind, durationMs, results });
    } catch (e) {
      return NextResponse.json({ ok: false, kind, error: (e as Error).message }, { status: 500 });
    }
  };
}
