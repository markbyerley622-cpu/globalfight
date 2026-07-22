import { NextResponse } from "next/server";
import { getOnlineCount } from "@/lib/online";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Live "N online". Public — it is an aggregate, never a list of who. */
export async function GET() {
  const count = await getOnlineCount().catch(() => null);
  if (!count) return NextResponse.json({ members: 0, total: 0, windowMinutes: 5 });
  return NextResponse.json(count, {
    // Shared cache already smooths the DB load; this stops a CDN pinning a
    // stale number for minutes.
    headers: { "cache-control": "public, max-age=15, stale-while-revalidate=30" },
  });
}
