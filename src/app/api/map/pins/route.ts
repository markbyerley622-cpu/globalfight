import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { getMapData } from "@/lib/geo/map-query";

/**
 * The map payload, on demand.
 *
 * ── Why this exists ───────────────────────────────────────────────────────
 * /map is a Server Component and renders fresh on every load, so a published
 * event already appears — on the NEXT navigation. The map is a page people
 * leave open, which is exactly the case that misses: a promoter publishes, a
 * card goes live, an event is called off, and the map on screen keeps showing
 * the world as it was when the tab was opened.
 *
 * This is the same `getMapData` the page calls, so there is one query and one
 * shape; the client refreshes into it rather than re-rendering the route.
 *
 * ── Why polling and not a stream ──────────────────────────────────────────
 * The state this carries changes on the order of minutes (an event is
 * published, a status flips to LIVE), not per second, and the payload is a few
 * hundred pins. A held-open SSE connection per map viewer would cost a server
 * process each to deliver something that a request a minute delivers just as
 * promptly. The countdown and the fight-week/live BANDS do not wait for this at
 * all — they are computed on the client's own clock (lib/geo/event-state), so
 * this endpoint is only ever needed for facts the client cannot derive.
 *
 * ── Access ────────────────────────────────────────────────────────────────
 * Read-only, and viewer-scoped exactly like the page: `getMapData` takes the
 * viewer id and the People layer decides per-pin what that viewer may see.
 * Anonymous callers get the public slice — the same thing they get by loading
 * /map, so this is not a new disclosure surface.
 */
export async function GET() {
  // A failure to identify the viewer degrades to anonymous rather than 500 —
  // the same `.catch(() => null)` the page uses, so a expired cookie shows the
  // public map instead of breaking the open tab's refresh loop.
  const user = await getCurrentUser().catch(() => null);
  const data = await getMapData(user?.id ?? null);

  return NextResponse.json(data, {
    // Never cached: two different viewers get different People layers, and a
    // shared cache entry would hand one viewer the other's slice.
    headers: { "cache-control": "private, no-store" },
  });
}

export const dynamic = "force-dynamic";
