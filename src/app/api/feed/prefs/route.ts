// POST /api/feed/prefs — "Not interested" (hide one video) / "Hide channel".
import { NextResponse } from "next/server";
import { hideChannel, notInterested } from "@/lib/feed/users";
import { feedKey } from "@/lib/feed/identity";
import { flog } from "@/lib/feed/log";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    const { cid = "anon", notInterestedId, hideChannelId } =
      (await req.json()) as { cid?: string; notInterestedId?: string; hideChannelId?: string };
    const key = await feedKey(cid);
    if (notInterestedId) notInterested(key, notInterestedId);
    if (hideChannelId) hideChannel(key, hideChannelId);
    return NextResponse.json({ ok: true });
  } catch (err) {
    flog.error({ op: "api.prefs", status: 400, err: (err as Error).message }, "prefs failed");
    return NextResponse.json({ error: (err as Error).message }, { status: 400 });
  }
}
