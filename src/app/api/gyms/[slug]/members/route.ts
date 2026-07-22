import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { authoriseGymEdit } from "@/lib/geo/gym-auth";

export const dynamic = "force-dynamic";

// ════════════════════════════════════════════════════════════════════════════
//  Roster management — the thing an owner could not do.
//
//  Before this, the ONLY code path that ever wrote GymMember.role was claim
//  approval, which sets exactly one person to "owner". Nothing could promote a
//  coach — so the gym page's Coaches section was a branch that could never be
//  taken, rendering an empty heading forever.
//
//  /membership (self-service: I train here / this is my home gym) is untouched.
//  This route is the OWNER acting on OTHER people, which is a different
//  authorisation question and therefore a different endpoint.
//
//  Two invariants the server enforces, because the UI cannot be trusted to:
//   · The gym's owner cannot be demoted or removed by anyone but an admin
//     resolving a new claim. Otherwise a coach could lock the owner out of
//     their own business page.
//   · memberCount is maintained in the same transaction as the row, so the
//     denormalised count on the map pin can never drift from reality.
// ════════════════════════════════════════════════════════════════════════════

const ROLES = ["member", "coach"] as const;

const Body = z.object({
  userId: z.string().min(1),
  /** Promote/demote. "owner" is deliberately not assignable here. */
  role: z.enum(ROLES).optional(),
  /** Remove from the roster entirely. */
  remove: z.boolean().optional(),
});

/** The full roster, for the dashboard. Owner-only: it carries join dates. */
export async function GET(_req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const auth = await authoriseGymEdit(slug);
  if (!auth.ok) return auth.response;

  const members = await prisma.gymMember.findMany({
    where: { gymId: auth.value.gym.id },
    orderBy: [{ role: "asc" }, { createdAt: "asc" }],
    select: {
      id: true, role: true, isHome: true, createdAt: true,
      user: {
        select: {
          id: true, name: true, username: true, image: true,
          registryRole: true, reputation: true, bio: true,
          instagram: true, website: true,
        },
      },
    },
  });

  return NextResponse.json({
    members: members.map((m) => ({
      id: m.id,
      role: m.role,
      isHome: m.isHome,
      joinedAt: m.createdAt.toISOString(),
      user: m.user,
    })),
    ownerId: auth.value.gym.ownerId,
  });
}

export async function PATCH(req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const auth = await authoriseGymEdit(slug);
  if (!auth.ok) return auth.response;
  const { gym } = auth.value;

  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Bad request." }, { status: 400 });
  const { userId, role, remove } = parsed.data;

  if (gym.ownerId && userId === gym.ownerId) {
    return NextResponse.json(
      { error: "The gym's owner can't be changed here. Ownership moves through a claim." },
      { status: 409 },
    );
  }

  const membership = await prisma.gymMember.findUnique({
    where: { gymId_userId: { gymId: gym.id, userId } },
    select: { id: true, role: true },
  });
  if (!membership) return NextResponse.json({ error: "They're not on this roster." }, { status: 404 });

  if (remove) {
    await prisma.$transaction([
      prisma.gymMember.delete({ where: { id: membership.id } }),
      prisma.gym.update({ where: { id: gym.id }, data: { memberCount: { decrement: 1 } } }),
    ]);
    return NextResponse.json({ ok: true, removed: userId });
  }

  if (!role) return NextResponse.json({ error: "Nothing to change." }, { status: 400 });

  const updated = await prisma.gymMember.update({
    where: { id: membership.id },
    data: { role },
    select: { id: true, role: true },
  });
  return NextResponse.json({ ok: true, member: { userId, role: updated.role } });
}
