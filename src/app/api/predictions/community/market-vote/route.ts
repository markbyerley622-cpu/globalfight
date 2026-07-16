import { NextResponse } from "next/server";
import { getSessionUserId } from "@/lib/auth";
import { voteOnMarket, type MarketVotePayload } from "@/features/predictions/community/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST /api/predictions/community/market-vote
//   { providerMarketId, sport, title, kind, options:[{id,label}], choice }
// Records the signed-in user's Combat Register vote on an external market.
export async function POST(req: Request) {
  const userId = await getSessionUserId();
  if (!userId) return NextResponse.json({ error: "Sign in to vote." }, { status: 401 });

  let body: Partial<MarketVotePayload>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }

  if (
    typeof body.providerMarketId !== "string" ||
    typeof body.choice !== "string" ||
    typeof body.title !== "string" ||
    typeof body.sport !== "string" ||
    typeof body.kind !== "string" ||
    !Array.isArray(body.options)
  ) {
    return NextResponse.json({ error: "Missing vote fields." }, { status: 400 });
  }

  const result = await voteOnMarket(userId, {
    providerMarketId: body.providerMarketId,
    sport: body.sport,
    title: body.title,
    kind: body.kind,
    options: body.options,
    choice: body.choice,
  });
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
  return NextResponse.json({ vote: result.vote });
}
