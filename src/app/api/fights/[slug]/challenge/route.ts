import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { challengeUser } from "@/lib/battles";
import { enforceLimit } from "@/lib/rate-limit/guard";
import { POLICY } from "@/lib/rate-limit";

/** Spectator → challenger. A community-room reader who disagrees taps Challenge
 *  on a message and the two are paired into a battle on this bout. Both sides
 *  must already have opposite picks — the prediction is the price of entry. */
export async function POST(req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Sign in to challenge someone." }, { status: 401 });
  const limited = await enforceLimit(req, "challenge", POLICY.challenge, user.id);
  if (limited) return limited;

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Invalid request." }, { status: 400 }); }

  /**
   * Two ways to name an opponent, because there are two callers.
   *
   *  - `userId`   — the community room, which already holds the speaker's id
   *                 from the room DTO it rendered.
   *  - `username` — the friend picker, which is fed by /api/users/search.
   *                 That endpoint deliberately does NOT return internal ids:
   *                 a typeahead open to any signed-in user is exactly the
   *                 surface you do not want handing out primary keys, and the
   *                 handle is the public identifier every other route uses.
   *
   * Resolved here rather than inside challengeUser so the service layer keeps
   * one identity type and the ownership rules it enforces stay unchanged.
   */
  const username = typeof body.username === "string" ? body.username.trim().replace(/^@+/, "") : null;
  let targetId = typeof body.userId === "string" ? body.userId : null;
  if (!targetId && username) {
    const target = await prisma.user.findUnique({ where: { username }, select: { id: true } });
    // Same 400 as "no opponent given" — a challenge endpoint must not double as
    // a username-existence oracle for anyone with a session.
    if (!target) return NextResponse.json({ error: "No opponent given." }, { status: 400 });
    targetId = target.id;
  }
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
