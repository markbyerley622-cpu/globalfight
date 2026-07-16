// GET /api/feed/reels — endless personalized batch (unseen-first, marks served).
import { NextResponse } from "next/server";
import { selectBatch } from "@/lib/feed/engine";
import { optsFromRequest } from "@/lib/feed/request";
import { feedKey } from "@/lib/feed/identity";
import { hydrateUser } from "@/lib/feed/users";
import { flog } from "@/lib/feed/log";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  try {
    const opts = optsFromRequest(req);
    const key = await feedKey(opts.cid);
    await hydrateUser(key);
    const { videos, live, total, exhaustedUnseen } = selectBatch(key, opts);
    return NextResponse.json({ live, total, exhaustedUnseen, count: videos.length, videos });
  } catch (err) {
    flog.error({ op: "api.reels", status: 500, err: (err as Error).message }, "reels request failed");
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
