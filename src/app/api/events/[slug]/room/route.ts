import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getOrCreateGeneralRoom } from "@/lib/community/rooms";

/** Provision-on-open: the event's GENERAL room (card-wide talk). Created lazily,
 *  only when a reader actually reaches the section — never during the event
 *  page's render. On failure this returns 503 and the section shows a quiet
 *  unavailable state; the rest of the page is entirely unaffected. */
export async function POST(_req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  try {
    const event = await prisma.event.findUnique({ where: { slug }, select: { id: true, name: true, sport: true } });
    if (!event) return NextResponse.json({ error: "Event not found" }, { status: 404 });
    return NextResponse.json(await getOrCreateGeneralRoom(event));
  } catch (e) {
    console.error("event general room provisioning failed", { slug, error: (e as Error).message });
    return NextResponse.json({ error: "Room unavailable" }, { status: 503 });
  }
}

export const dynamic = "force-dynamic";
