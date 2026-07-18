import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getOrCreateEventThread } from "@/lib/community/entity-threads";

/** Provision-on-open: the event's discussion thread is created lazily, only when
 *  a user actually opens the Discussion tab — never during the event page's
 *  render. On any failure this returns 503 (the client hides the tab); it can
 *  never take down the event page. */
export async function POST(_req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  try {
    const event = await prisma.event.findUnique({ where: { slug }, select: { id: true, name: true, sport: true } });
    if (!event) return NextResponse.json({ error: "Event not found" }, { status: 404 });
    const thread = await getOrCreateEventThread(event);
    return NextResponse.json(thread);
  } catch (e) {
    console.error("event discussion provisioning failed", { slug, error: (e as Error).message });
    return NextResponse.json({ error: "Discussion unavailable" }, { status: 503 });
  }
}

export const dynamic = "force-dynamic";
