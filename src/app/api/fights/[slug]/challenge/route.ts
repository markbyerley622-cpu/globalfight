import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { challengeUser } from "@/lib/battles";

/** Spectator → challenger. A community-room reader who disagrees taps Challenge
 *  on a message and the two are paired into a battle on this bout. Both sides
 *  must already have opposite picks — the prediction is the price of entry. */
export async function POST(req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Sign in to challenge someone." }, { status: 401 });

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Invalid request." }, { status: 400 }); }
  const targetId = typeof body.userId === "string" ? body.userId : null;
  if (!targetId) return NextResponse.json({ error: "No opponent given." }, { status: 400 });

  const fight = await prisma.fight.findUnique({ where: { slug }, select: { id: true, result: true, event: { select: { date: true } } } });
  if (!fight) return NextResponse.json({ error: "Fight not found." }, { status: 404 });
  if (fight.result !== "SCHEDULED" || (fight.event?.date && fight.event.date.getTime() <= Date.now())) {
    return NextResponse.json({ error: "This bout is locked — no new battles." }, { status: 400 });
  }

  const result = await challengeUser(user.id, fight.id, targetId);
  if ("error" in result) return NextResponse.json(result, { status: 400 });
  return NextResponse.json(result, { status: 201 });
}

export const dynamic = "force-dynamic";
