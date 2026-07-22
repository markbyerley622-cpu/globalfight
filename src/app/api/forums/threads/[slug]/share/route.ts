import { NextResponse } from "next/server";
import { recordShare } from "@/lib/forum/repo";
import { hit, clientIp, POLICY } from "@/lib/rate-limit";

/**
 * Record a share (any channel). Increments the thread's share counter, which
 * feeds the trending score.
 *
 * Deliberately still ANONYMOUS — sharing a link shouldn't require an account —
 * but rate-limited per IP+thread. Unbounded, this endpoint was a one-line
 * script for driving any thread to the top of trending: no session, no limit,
 * and a direct write to a ranking input.
 */
export async function POST(req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;

  const gate = await hit(
    `share:${clientIp(req)}:${slug}`,
    POLICY.threadShare.limit,
    POLICY.threadShare.windowMs,
  );
  if (!gate.ok) {
    // 200, not 429: a share is fire-and-forget from the client's point of view
    // and an error toast for "you shared this a lot" is noise. The count simply
    // does not move.
    return NextResponse.json({ ok: true, counted: false });
  }

  try {
    return NextResponse.json(await recordShare(slug));
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Could not record share." }, { status: 400 });
  }
}

export const dynamic = "force-dynamic";
