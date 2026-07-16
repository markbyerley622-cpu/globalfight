import { NextResponse } from "next/server";
import { getMarket } from "@/features/predictions/service/predictions-service";
import { marketDataAllowed } from "@/lib/feature-flags";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/predictions/:id  — id is the normalized, provider-namespaced id
// (URL-encoded), e.g. "polymarket%3A0xabc" or "kalshi%3AKXUFCFIGHT-…".
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {

  // Market data is DISABLED by default. A disabled feature must be unreachable via
  // the API, not merely hidden in the UI.
  if (!marketDataAllowed()) {
    return NextResponse.json(
      { error: "Not found." },
      { status: 404, headers: { "cache-control": "private, no-store" } },
    );
  }
  const { id } = await ctx.params;
  const market = await getMarket(decodeURIComponent(id));
  if (!market) return NextResponse.json({ error: "Market not found." }, { status: 404 });
  return NextResponse.json({ market });
}
