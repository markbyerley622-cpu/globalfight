import { NextResponse } from "next/server";
import { listMarkets, getCategories } from "@/features/predictions/service/predictions-service";
import { COMBAT_SPORTS, type CombatSport, type MarketSort } from "@/features/predictions/types";
import { marketDataAllowed } from "@/lib/feature-flags";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SORTS: MarketSort[] = ["popular", "closing", "trending", "new"];

// GET /api/predictions?sport=MMA&sort=popular&q=…&limit=50
//
// Market data is DISABLED by default. When the flags are off this route behaves as
// if it does not exist (404) — hiding the UI is not a control; the API must be shut
// too, or the data is still publicly retrievable.
//
// Note the cache header. It used to be `public, s-maxage=60, stale-while-revalidate=600`,
// which put Kalshi/Polymarket prices into a shared CDN cache and re-served them to
// the world. That is redistribution, and it is exactly what their terms forbid. Any
// response derived from restricted third-party data is now `private, no-store`.
export async function GET(req: Request) {
  if (!marketDataAllowed()) {
    return NextResponse.json(
      { error: "Not found." },
      { status: 404, headers: { "cache-control": "private, no-store" } },
    );
  }

  const url = new URL(req.url);
  const sportParam = url.searchParams.get("sport");
  const sortParam = url.searchParams.get("sort");
  const q = url.searchParams.get("q") ?? undefined;
  const limitParam = url.searchParams.get("limit");

  const sport =
    sportParam && (COMBAT_SPORTS as readonly string[]).includes(sportParam)
      ? (sportParam as CombatSport)
      : "all";
  const sort = sortParam && SORTS.includes(sortParam as MarketSort) ? (sortParam as MarketSort) : "popular";
  const limit = limitParam ? Math.min(200, Math.max(1, Number(limitParam) || 0)) : undefined;

  const [markets, categories] = await Promise.all([
    listMarkets({ sport, sort, q, limit }),
    getCategories(),
  ]);

  return NextResponse.json(
    { markets, categories, count: markets.length },
    { headers: { "cache-control": "private, no-store" } },
  );
}
