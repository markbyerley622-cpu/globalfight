import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { submitGymReview, deleteGymReview, SKILL_LEVELS } from "@/lib/gym-reviews";
import { enforceLimit } from "@/lib/rate-limit/guard";
import { POLICY } from "@/lib/rate-limit";

const star = z.number().int().min(1).max(5);

const Body = z.object({
  overall: star,
  coaching: star.nullish(),
  facilities: star.nullish(),
  atmosphere: star.nullish(),
  cleanliness: star.nullish(),
  value: star.nullish(),
  title: z.string().trim().max(120).nullish(),
  body: z.string().trim().min(3).max(4000),
  recommended: z.boolean(),
  skillLevel: z.enum(SKILL_LEVELS).nullish(),
  disciplines: z.array(z.string().trim().min(1).max(40)).max(12).default([]),
});

async function gymIdFor(slug: string): Promise<string | null> {
  const gym = await prisma.gym.findUnique({ where: { slug }, select: { id: true } });
  return gym?.id ?? null;
}

/** Create or update the viewer's review of this gym. */
export async function POST(req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Sign in to review a gym." }, { status: 401 });
  const limited = await enforceLimit(req, "gym-review", POLICY.gymReview, user.id);
  if (limited) return limited;
  const { slug } = await params;
  const gymId = await gymIdFor(slug);
  if (!gymId) return NextResponse.json({ error: "Gym not found." }, { status: 404 });

  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Check your review and try again." }, { status: 400 });

  try {
    await submitGymReview(user.id, gymId, parsed.data);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Could not save your review." }, { status: 400 });
  }
}

/** Remove the viewer's own review. */
export async function DELETE(_req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  const { slug } = await params;
  const gymId = await gymIdFor(slug);
  if (!gymId) return NextResponse.json({ error: "Gym not found." }, { status: 404 });

  await deleteGymReview(user.id, gymId);
  return NextResponse.json({ ok: true });
}
