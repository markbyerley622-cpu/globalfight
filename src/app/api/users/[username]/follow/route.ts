import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { setFollow, getFollowCounts } from "@/lib/geo/people";

/**
 * Follow / unfollow a person.
 *
 * Toggle-by-default so the button has one endpoint, but an explicit `follow`
 * boolean wins — a double-tap on a flaky connection must not silently undo
 * itself.
 */
export async function POST(req: Request, { params }: { params: Promise<{ username: string }> }) {
  const { username } = await params;
  const me = await getCurrentUser();
  if (!me) return NextResponse.json({ error: "Sign in to follow people." }, { status: 401 });

  const target = await prisma.user.findUnique({ where: { username }, select: { id: true } });
  if (!target) return NextResponse.json({ error: "No such user." }, { status: 404 });
  if (target.id === me.id) {
    return NextResponse.json({ error: "You can't follow yourself." }, { status: 400 });
  }

  const body = (await req.json().catch(() => ({}))) as { follow?: boolean };
  const existing = await prisma.userFollow.findUnique({
    where: { followerId_followingId: { followerId: me.id, followingId: target.id } },
    select: { id: true },
  });
  const next = typeof body.follow === "boolean" ? body.follow : !existing;

  await setFollow(me.id, target.id, next);
  const counts = await getFollowCounts(target.id);

  // `counts.following` is the TARGET's outbound count; `following` is the
  // viewer's own relationship to them. Two different questions — name them so.
  return NextResponse.json({
    following: next,
    followerCount: counts.followers,
    followingCount: counts.following,
  });
}

export const dynamic = "force-dynamic";
