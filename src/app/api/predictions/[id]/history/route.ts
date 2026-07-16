import { NextResponse } from "next/server";
import { getMarketHistory } from "@/features/predictions/service/predictions-service";
import { marketDataAllowed } from "@/lib/feature-flags";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/predictions/:id/history — probability time-series for the market's
// primary/favourite outcome, powering the line graph. Returns { history: null }
// (200) when a provider has no series, so the UI degrades gracefully.
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
  const history = await getMarketHistory(decodeURIComponent(id));
  return NextResponse.json(
    { history },
    { headers: { "cache-control": "private, no-store" } },
  );
}
