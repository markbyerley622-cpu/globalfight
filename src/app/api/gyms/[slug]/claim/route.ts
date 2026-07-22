import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";

const Body = z.object({
  evidence: z.string().trim().min(10).max(600),
  note: z.string().trim().max(300).optional(),
});

/**
 * Claim ownership of a gym page.
 *
 * Files a PENDING claim and nothing else. It does not set `verified`, it does
 * not set `ownerId`, and it deliberately has no auto-approval path — the whole
 * point of a claim is that a human checks it. An admin approving the row is
 * what grants control, exactly as with FighterClaim.
 */
export async function POST(req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Sign in to claim a gym." }, { status: 401 });

  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Tell us how you can prove it." },
      { status: 400 },
    );
  }

  const gym = await prisma.gym.findUnique({ where: { slug }, select: { id: true, ownerId: true } });
  if (!gym) return NextResponse.json({ error: "No such gym." }, { status: 404 });
  if (gym.ownerId) {
    return NextResponse.json({ error: "This gym is already claimed." }, { status: 409 });
  }

  const existing = await prisma.gymClaim.findFirst({
    where: { gymId: gym.id, claimantId: user.id, status: { in: ["pending", "info_requested"] } },
    select: { id: true },
  });
  if (existing) {
    return NextResponse.json({ error: "You already have a claim under review." }, { status: 409 });
  }

  await prisma.gymClaim.create({
    data: {
      gymId: gym.id,
      claimantId: user.id,
      evidence: parsed.data.evidence,
      note: parsed.data.note || null,
    },
  });

  return NextResponse.json({ ok: true, status: "pending" }, { status: 201 });
}

export const dynamic = "force-dynamic";
