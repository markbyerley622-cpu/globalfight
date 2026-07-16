import { NextResponse } from "next/server";
import { recordShare } from "@/lib/forum/repo";

/**
 * Record a share (any channel). Increments the thread's share counter, which
 * feeds the trending score. Open to anyone — sharing doesn't require an account.
 */
export async function POST(_req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  try {
    return NextResponse.json(await recordShare(slug));
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Could not record share." }, { status: 400 });
  }
}

export const dynamic = "force-dynamic";
