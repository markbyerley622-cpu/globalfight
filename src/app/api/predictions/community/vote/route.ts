import { NextResponse } from "next/server";
import { getSessionUserId } from "@/lib/auth";
import { castVote } from "@/features/predictions/community/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST /api/predictions/community/vote  { marketId, choice }
export async function POST(req: Request) {
  const userId = await getSessionUserId();
  if (!userId) return NextResponse.json({ error: "Sign in to vote." }, { status: 401 });

  let body: { marketId?: unknown; choice?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }
  if (typeof body.marketId !== "string" || typeof body.choice !== "string") {
    return NextResponse.json({ error: "marketId and choice are required." }, { status: 400 });
  }

  const result = await castVote(userId, body.marketId, body.choice);
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
  return NextResponse.json({ market: result.market });
}
