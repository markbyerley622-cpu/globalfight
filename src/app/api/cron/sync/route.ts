import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { syncSports, type SyncEntity } from "@/services/sync/run";
import { enrichBoxingFighters } from "@/services/sync/enrich-boxing-fighters";
import type { Sport } from "@/lib/types";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const isAdmin = (role: string) => role === "ADMIN" || role === "MODERATOR";

// Sport groups per the spec's cron jobs (sync-mma, sync-boxing, …).
const GROUPS: Record<string, Sport[]> = {
  mma: ["MMA", "BARE_KNUCKLE"],
  boxing: ["BOXING"],
  kickboxing: ["KICKBOXING", "MUAY_THAI", "K1"],
  bjj: ["BJJ", "BJJ_NOGI", "WRESTLING"],
};

const VALID_ENTITY = new Set<SyncEntity>(["events", "fighters", "results"]);

// APIs-first sync with automatic scraper fallback. Trigger via cron with the
// shared secret, or as an admin. Example:
//   POST /api/cron/sync?group=mma&entity=events   (x-cron-secret header)
export async function POST(req: Request) {
  const user = await getCurrentUser();
  const secret = req.headers.get("x-cron-secret");
  const viaCron = secret && secret === process.env.SCRAPE_CRON_SECRET;
  if (!viaCron && (!user || !isAdmin(user.role))) {
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
