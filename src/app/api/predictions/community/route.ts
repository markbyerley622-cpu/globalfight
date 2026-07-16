import { NextResponse } from "next/server";
import { getSessionUserId } from "@/lib/auth";
import { getCommunityMarkets } from "@/features/predictions/community/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/predictions/community — native Combat Register questions with real
// vote tallies; includes the signed-in user's own votes when authenticated.
export async function GET() {
  const userId = await getSessionUserId();
  const markets = await getCommunityMarkets(userId);
  return NextResponse.json({ markets, count: markets.length });
}
