// GET /api/feed/library/collection?id=…  → a collection's videos
import { NextResponse } from "next/server";
import { feedKey } from "@/lib/feed/identity";
import { getCollectionItems } from "@/lib/feed/library";
import { flog } from "@/lib/feed/log";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  try {
    const q = new URL(req.url).searchParams;
    const id = q.get("id");
    if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });
    const key = await feedKey(q.get("cid") || "anon");
    const data = await getCollectionItems(key, id);
    if (!data) return NextResponse.json({ error: "not found" }, { status: 404 });
    return NextResponse.json(data);
  } catch (err) {
    flog.error({ op: "api.library.collection", err: (err as Error).message }, "collection fetch failed");
    return NextResponse.json({ error: (err as Error).message }, { status: 400 });
  }
}
