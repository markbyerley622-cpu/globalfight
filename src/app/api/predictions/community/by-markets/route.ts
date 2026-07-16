import { NextResponse } from "next/server";
import { getSessionUserId } from "@/lib/auth";
import { getMarketVotes } from "@/features/predictions/community/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST /api/predictions/community/by-markets  { ids: string[] }
// Returns the Combat Register community vote (tally/voteCount/myVote/options)
// for each provider market id, so live cards can show the community verdict.
export async function POST(req: Request) {
  const userId = await getSessionUserId();
  let body: { ids?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ votes: {} });
  }
  const ids = Array.isArray(body.ids) ? body.ids.filter((x): x is string => typeof x === "string").slice(0, 120) : [];
  const votes = await getMarketVotes(ids, userId);
  return NextResponse.json({ votes });
}
