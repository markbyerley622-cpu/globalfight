import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";

/** The viewer's own gym claims, plus any gym they already own. */
export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Sign in." }, { status: 401 });

  const [claims, owned] = await Promise.all([
    prisma.gymClaim.findMany({
      where: { claimantId: user.id },
      orderBy: { createdAt: "desc" },
      take: 10,
      select: {
        id: true, status: true, note: true, createdAt: true, reviewedAt: true,
        gym: { select: { slug: true, name: true, city: true } },
      },
    }),
    prisma.gym.findMany({
      where: { ownerId: user.id },
      orderBy: { name: "asc" },
      select: { slug: true, name: true, city: true, verified: true, memberCount: true },
    }),
  ]);

  return NextResponse.json({ claims, owned });
}

export const dynamic = "force-dynamic";
