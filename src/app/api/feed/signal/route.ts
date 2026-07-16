// POST /api/feed/signal — an engagement signal (Respect / full watch) bumps
// this client's interest weights for the video's tags.
import { NextResponse } from "next/server";
import { findById } from "@/lib/feed/store";
import { addSignal } from "@/lib/feed/users";
import { feedKey } from "@/lib/feed/identity";
import { flog } from "@/lib/feed/log";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    const { cid = "anon", id } = (await req.json()) as { cid?: string; id?: string };
    const key = await feedKey(cid);
    const v = id ? findById(id) : undefined;
    if (v) addSignal(key, v.tags || [], 1);
    return NextResponse.json({ ok: true });
  } catch (err) {
    flog.error({ op: "api.signal", status: 400, err: (err as Error).message }, "signal failed");
    return NextResponse.json({ error: (err as Error).message }, { status: 400 });
  }
}
