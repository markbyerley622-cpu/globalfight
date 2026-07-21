import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { isAdminRole } from "@/lib/admin/guard";
import { cronAuthorized } from "@/lib/scraper/cron-handler";
import { syncSports, type SyncEntity } from "@/services/sync/run";
import { enrichBoxingFighters } from "@/services/sync/enrich-boxing-fighters";
import type { Sport } from "@/lib/types";

export const dynamic = "force-dynamic";
export const maxDuration = 300;


// Sport groups per the spec's cron jobs (sync-mma, sync-boxing, …).
const GROUPS: Record<string, Sport[]> = {
  mma: ["MMA", "BARE_KNUCKLE"],
  boxing: ["BOXING"],
  kickboxing: ["KICKBOXING", "MUAY_THAI", "K1"],
  bjj: ["BJJ", "BJJ_NOGI", "WRESTLING"],
};

const VALID_ENTITY = new Set<SyncEntity>(["events", "fighters", "results"]);
const ALL_ENTITIES: SyncEntity[] = ["events", "fighters", "results"];

/**
 * Scheduled entry point — every group x every entity.
 *
 * This route answered POST only, behind an `x-cron-secret` header, while
 * vercel.json and render.yaml both call it with GET + `Authorization: Bearer`.
 * It returned 405 on every tick and had never once run; render.yaml's `|| true`
 * swallowed the failure, and because refresh-events/refresh-odds do work, events
 * still appeared and hid it.
 *
 * GET deliberately takes no parameters. The POST defaults are group=mma &
 * entity=events, so a bare parameterless call would have synced MMA events and
 * nothing else — boxing, kickboxing and BJJ would stay dark, which is a subtler
 * version of the same silent gap. The cron wants everything; a caller who wants
 * one slice uses POST with explicit params.
 *
 * Runs sequentially (syncSports already serialises per sport) to stay inside
 * upstream rate limits, and isolates failures per group/entity so one dead
 * provider can't abort the rest of the sweep.
 */
export async function GET(req: Request) {
  if (!cronAuthorized(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const started = Date.now();
  const results: Record<string, unknown> = {};

  for (const [group, sports] of Object.entries(GROUPS)) {
    for (const entity of ALL_ENTITIES) {
      const key = `${group}:${entity}`;
      try {
        results[key] = await syncSports(sports, entity);
      } catch (e) {
        results[key] = { error: (e as Error).message };
      }
    }
  }

  return NextResponse.json({ ok: true, kind: "sync", durationMs: Date.now() - started, results });
}

// APIs-first sync with automatic scraper fallback, for ONE explicit slice.
// This is the manual/admin entry point — the scheduled sweep is GET above.
// Example:
//   POST /api/cron/sync?group=mma&entity=events   (x-cron-secret header)
export async function POST(req: Request) {
  const user = await getCurrentUser();
  const secret = req.headers.get("x-cron-secret");
  const viaCron = secret && secret === process.env.SCRAPE_CRON_SECRET;
  if (!viaCron && (!user || !isAdminRole(user.role))) {
    return NextResponse.json({ error: "Forbidden." }, { status: 403 });
  }

  const url = new URL(req.url);
  const group = (url.searchParams.get("group") ?? "mma").toLowerCase();
  const rawEntity = url.searchParams.get("entity") ?? "events";

  // Incremental boxing-fighter enrichment (quota-capped). Example:
  //   POST /api/cron/sync?entity=enrich&limit=15   (x-cron-secret header)
  if (rawEntity === "enrich" || group === "enrich") {
    const limit = Math.min(Number(url.searchParams.get("limit") ?? 15) || 15, 50);
    const out = await enrichBoxingFighters(limit);
    return NextResponse.json({ action: "enrich-boxing-fighters", limit, ...out });
  }

  const entityParam = rawEntity as SyncEntity;
  const sports = GROUPS[group];
  if (!sports) {
    return NextResponse.json({ error: `Unknown group '${group}'. Use one of: ${Object.keys(GROUPS).join(", ")}.` }, { status: 400 });
  }
  if (!VALID_ENTITY.has(entityParam)) {
    return NextResponse.json({ error: `Unknown entity '${entityParam}'. Use events | fighters | results.` }, { status: 400 });
  }

  const results = await syncSports(sports, entityParam);
  return NextResponse.json({ group, entity: entityParam, results });
}
