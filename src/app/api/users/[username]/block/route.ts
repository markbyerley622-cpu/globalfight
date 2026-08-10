import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { blockUser, unblockUser, hasBlocked } from "@/lib/blocks/repo";
import { enforceLimit } from "@/lib/rate-limit/guard";
import { POLICY } from "@/lib/rate-limit";

/**
 * Block / unblock a person.
 *
 * Shaped exactly like the follow endpoint next door — explicit `blocked`
 * boolean wins over a bare toggle, so a double-tap or a retry on a flaky
 * connection cannot silently undo itself. That matters more here than it does
 * for a follow: silently un-blocking someone reopens a channel the user
 * deliberately closed.
 *
 * ANSWERS THE SAME WAY WHETHER OR NOT A BLOCK ALREADY EXISTED. The blocked
 * party is never told, and the response carries no counter, so nothing here is
 * an oracle for what anyone else has done.
 */
export async function POST(req: Request, { params }: { params: Promise<{ username: string }> }) {
  const { username } = await params;
  const me = await getCurrentUser();
  if (!me) return NextResponse.json({ error: "Sign in to block people." }, { status: 401 });

  // Same budget as a follow: it is a per-account write against another person's
  // relationship graph, and blocking severs follows, so an unbounded loop is a
  // way to churn someone else's rows.
  const limited = await enforceLimit(req, "user-block", POLICY.interaction, me.id);
  if (limited) return limited;

  const target = await prisma.user.findUnique({ where: { username }, select: { id: true } });
  if (!target) return NextResponse.json({ error: "No such user." }, { status: 404 });
  if (target.id === me.id) {
    return NextResponse.json({ error: "You can't block yourself." }, { status: 400 });
  }

  const body = (await req.json().catch(() => ({}))) as { blocked?: boolean };
  const next = typeof body.blocked === "boolean" ? body.blocked : !(await hasBlocked(me.id, target.id));

  try {
    if (next) await blockUser(me.id, target.id);
    else await unblockUser(me.id, target.id);
  } catch (err) {
    // The service throws human strings on purpose (CLAUDE.md rule 5); the ORM
    // errors that would name a model are prevented at the source by
    // createMany(skipDuplicates) / deleteMany.
    return NextResponse.json({ error: (err as Error).message }, { status: 400 });
  }

  return NextResponse.json({ blocked: next });
}

export const dynamic = "force-dynamic";
