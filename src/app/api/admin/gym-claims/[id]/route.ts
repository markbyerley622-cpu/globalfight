import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { isAdminRole } from "@/lib/admin/guard";

const Body = z.object({
  action: z.enum(["approve", "reject", "info"]),
  note: z.string().max(300).optional(),
});

/**
 * Decide a gym claim.
 *
 * Approval is the ONLY thing that sets `Gym.ownerId` and `Gym.verified`, and it
 * does both plus the claimant's owner membership in one transaction — a gym
 * that is verified but ownerless, or owned by someone who is not a member, is a
 * state nothing else in the app knows how to render.
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await getCurrentUser();
  if (!user || !isAdminRole(user.role)) return NextResponse.json({ error: "Forbidden." }, { status: 403 });

  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Bad request." }, { status: 400 });
  const { action, note } = parsed.data;

  const claim = await prisma.gymClaim.findUnique({
    where: { id },
    select: { id: true, gymId: true, claimantId: true, status: true },
  });
  if (!claim) return NextResponse.json({ error: "No such claim." }, { status: 404 });

  const status = action === "approve" ? "approved" : action === "reject" ? "rejected" : "info_requested";

  await prisma.$transaction(async (tx) => {
    await tx.gymClaim.update({
      where: { id: claim.id },
      data: { status, note: note ?? undefined, reviewerId: user.id, reviewedAt: new Date() },
    });

    if (action !== "approve") return;

    await tx.gym.update({
      where: { id: claim.gymId },
      data: { ownerId: claim.claimantId, verified: true },
    });

    // The owner is also a member, with the owner role — so the gym page's
    // coach/member lists include them without a second special case.
    const existing = await tx.gymMember.findUnique({
      where: { gymId_userId: { gymId: claim.gymId, userId: claim.claimantId } },
      select: { id: true },
    });
    if (existing) {
      await tx.gymMember.update({ where: { id: existing.id }, data: { role: "owner" } });
    } else {
      await tx.gymMember.create({ data: { gymId: claim.gymId, userId: claim.claimantId, role: "owner" } });
      await tx.gym.update({ where: { id: claim.gymId }, data: { memberCount: { increment: 1 } } });
    }

    // Competing claims on the same gym can no longer be approved.
    await tx.gymClaim.updateMany({
      where: { gymId: claim.gymId, id: { not: claim.id }, status: { in: ["pending", "info_requested"] } },
      data: { status: "rejected", reviewerId: user.id, reviewedAt: new Date() },
    });
  });

  return NextResponse.json({ ok: true, status });
}

export const dynamic = "force-dynamic";
