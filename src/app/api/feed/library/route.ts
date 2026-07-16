// GET  /api/feed/library        → the user's collections + all saved video ids
// POST /api/feed/library        → save | unsave | create | deleteCollection
import { NextResponse } from "next/server";
import { feedKey } from "@/lib/feed/identity";
import {
  listLibrary, saveVideo, unsaveVideo, createCollection, deleteCollection,
  type SaveInput, type SystemKind,
} from "@/lib/feed/library";
import { findById } from "@/lib/feed/store";
import { addSignal } from "@/lib/feed/users";
import { flog } from "@/lib/feed/log";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  try {
    const cid = new URL(req.url).searchParams.get("cid") || "anon";
    const key = await feedKey(cid);
    return NextResponse.json(await listLibrary(key));
  } catch (err) {
    flog.error({ op: "api.library.list", err: (err as Error).message }, "library list failed");
    return NextResponse.json({ collections: [], savedIds: [] });
  }
}

interface Body {
  cid?: string;
  action: "save" | "unsave" | "create" | "deleteCollection";
  video?: SaveInput;
  videoId?: string;
  collectionId?: string;
  system?: SystemKind;
  name?: string;
  id?: string;
}

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as Body;
    const key = await feedKey(body.cid || "anon");
    switch (body.action) {
      case "save": {
        if (!body.video?.id) return NextResponse.json({ error: "video required" }, { status: 400 });
        const r = await saveVideo(key, body.video, { collectionId: body.collectionId, system: body.system });
        // a save is a strong interest signal — weight it above a Respect
        const cat = findById(body.video.id);
        if (cat?.tags?.length) addSignal(key, cat.tags, 2);
        return NextResponse.json({ ok: true, ...r });
      }
      case "unsave":
        if (!body.videoId) return NextResponse.json({ error: "videoId required" }, { status: 400 });
        await unsaveVideo(key, body.videoId, body.collectionId);
        return NextResponse.json({ ok: true });
      case "create":
        return NextResponse.json({ ok: true, collection: await createCollection(key, body.name || "") });
      case "deleteCollection":
        if (body.id) await deleteCollection(key, body.id);
        return NextResponse.json({ ok: true });
      default:
        return NextResponse.json({ error: "unknown action" }, { status: 400 });
    }
  } catch (err) {
    flog.error({ op: "api.library.post", err: (err as Error).message }, "library action failed");
    return NextResponse.json({ error: (err as Error).message }, { status: 400 });
  }
}
