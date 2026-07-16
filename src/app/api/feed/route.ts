// GET /api/feed — ranked catalog slice for the grid (browsing).
import { NextResponse } from "next/server";
import { rankedList } from "@/lib/feed/engine";
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
    const { videos, count, live } = rankedList(key, opts);
    return NextResponse.json({ live, count, videos });
  } catch (err) {
    flog.error({ op: "api.feed", status: 500, err: (err as Error).message }, "feed request failed");
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
