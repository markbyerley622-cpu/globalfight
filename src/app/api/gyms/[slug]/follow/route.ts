import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { toggleFollow, followerCount } from "@/lib/follow-targets";
import { enforceLimit } from "@/lib/rate-limit/guard";
import { POLICY } from "@/lib/rate-limit";

/**
 * Follow / unfollow a gym.
 *
 * Toggle-by-default so the button has one endpoint, but an explicit `follow`
 * boolean WINS — a double-tap on a flaky connection must not silently undo itself.
 * Same contract as the fighter/promotion/event/person routes, so FollowButton needs
 * no per-entity branch.
 *
 * Rate-limited: a follow is a cheap write that fans out notifications to everyone
 * following the target, so an unfollow/refollow loop is a spam vector.
 */
export async function POST(req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const me = await getCurrentUser();
  if (!me) return NextResponse.json({ error: "Sign in to follow gyms." }, { status: 401 });

  const limited = await enforceLimit(req, "follow", POLICY.interaction, me.id);
  if (limited) return limited;

  const gym = await prisma.gym.findUnique({ where: { slug }, select: { id: true } });
  if (!gym) return NextResponse.json({ error: "No such gym." }, { status: 404 });

  const body = (await req.json().catch(() => ({}))) as { follow?: boolean };
  const { following } = await toggleFollow(
    me.id,
    { type: "gym", id: gym.id },
    typeof body.follow === "boolean" ? body.follow : undefined,
  );

  return NextResponse.json({ following, followers: await followerCount({ type: "gym", id: gym.id }) });
}

export const dynamic = "force-dynamic";
