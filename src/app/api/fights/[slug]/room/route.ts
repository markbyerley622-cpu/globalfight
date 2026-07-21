import { NextResponse } from "next/server";
import { getSessionUserId } from "@/lib/auth";
import { getFightRoom } from "@/lib/community/rooms";

/** Open-on-demand: a bout's arena — both discussion layers, the battle banner
 *  and speaker identity — in ONE request. The rooms are provisioned here, on
 *  first open, never during the event page's render. A failure degrades to 503
 *  and the module shows a quiet unavailable state; the card is untouched. */
export async function POST(_req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  try {
    const viewerId = (await getSessionUserId()) ?? undefined;
    const room = await getFightRoom(slug, viewerId);
    if (!room) return NextResponse.json({ error: "Fight not found" }, { status: 404 });
    return NextResponse.json(room);
  } catch (e) {
    console.error("fight room open failed", { slug, error: (e as Error).message });
    return NextResponse.json({ error: "Room unavailable" }, { status: 503 });
  }
}

export const dynamic = "force-dynamic";
