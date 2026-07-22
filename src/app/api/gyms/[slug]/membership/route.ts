import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { setGymMembership } from "@/lib/geo/gyms";

const Body = z.object({
  join: z.boolean(),
  /** Promote to home gym. Exclusive — the service demotes any previous one. */
  isHome: z.boolean().optional(),
});

/** Join / leave a gym, or set it as your home gym. */
export async function POST(req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Sign in to join a gym." }, { status: 401 });

  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Bad request." }, { status: 400 });

  const gym = await prisma.gym.findUnique({ where: { slug }, select: { id: true } });
  if (!gym) return NextResponse.json({ error: "No such gym." }, { status: 404 });

  await setGymMembership({
    userId: user.id,
    gymId: gym.id,
    join: parsed.data.join,
    isHome: parsed.data.isHome,
  });

  const [membership, memberCount] = await Promise.all([
    prisma.gymMember.findUnique({
      where: { gymId_userId: { gymId: gym.id, userId: user.id } },
      select: { role: true, isHome: true },
    }),
    prisma.gym.findUnique({ where: { id: gym.id }, select: { memberCount: true } }),
  ]);

  return NextResponse.json({
    member: !!membership,
    isHome: membership?.isHome ?? false,
    role: membership?.role ?? null,
    memberCount: memberCount?.memberCount ?? 0,
  });
}

export const dynamic = "force-dynamic";
