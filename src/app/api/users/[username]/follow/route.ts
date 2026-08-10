import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { setFollow, getFollowCounts } from "@/lib/geo/people";
import { blockExistsBetween } from "@/lib/blocks/repo";
import { enforceLimit } from "@/lib/rate-limit/guard";
import { POLICY } from "@/lib/rate-limit";

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

  // A follow writes a row AND fires a FOLLOW notification into someone else's
  // inbox, so an unbounded loop is a notification-spam vector aimed at a person
  // rather than a page. Keyed to the account: rotating IPs must not buy more.
  const limited = await enforceLimit(req, "user-follow", POLICY.interaction, me.id);
  if (limited) return limited;

  const target = await prisma.user.findUnique({ where: { username }, select: { id: true } });
  if (!target) return NextResponse.json({ error: "No such user." }, { status: 404 });
  if (target.id === me.id) {
    return NextResponse.json({ error: "You can't follow yourself." }, { status: 400 });
  }

  // A follow puts the target's activity in your feed and fires a notification
  // into theirs, so it is exactly the channel a block exists to close. Symmetric
  // (lib/blocks/repo): neither party can follow the other, whoever pressed
  // block. Worded identically in both directions so this is not a probe for
  // whether someone blocked you.
  if (await blockExistsBetween(me.id, target.id)) {
    return NextResponse.json({ error: "You can't follow this person." }, { status: 403 });
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
