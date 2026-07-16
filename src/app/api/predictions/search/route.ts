import { NextResponse } from "next/server";
import { searchMarkets } from "@/features/predictions/service/predictions-service";
import { COMBAT_SPORTS, type CombatSport } from "@/features/predictions/types";
import { marketDataAllowed } from "@/lib/feature-flags";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/predictions/search?q=pimblett&sport=MMA
export async function GET(req: Request) {

  // Market data is DISABLED by default. A disabled feature must be unreachable via
  // the API, not merely hidden in the UI.
  if (!marketDataAllowed()) {
    return NextResponse.json(
      { error: "Not found." },
      { status: 404, headers: { "cache-control": "private, no-store" } },
    );
  }
  const url = new URL(req.url);
  const q = url.searchParams.get("q")?.trim() ?? "";
  const sportParam = url.searchParams.get("sport");
  const sport =
    sportParam && (COMBAT_SPORTS as readonly string[]).includes(sportParam)
      ? (sportParam as CombatSport)
      : "all";

  if (!q) return NextResponse.json({ markets: [], count: 0 });

  const markets = await searchMarkets(q, { sport });
  return NextResponse.json({ markets, count: markets.length });
}
