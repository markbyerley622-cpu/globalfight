import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { toggleHelpful } from "@/lib/gym-reviews";
import { enforceLimit } from "@/lib/rate-limit/guard";
import { POLICY } from "@/lib/rate-limit";

/** Toggle the viewer's "helpful" vote on a review. */
export async function POST(req: Request, { params }: { params: Promise<{ slug: string; reviewId: string }> }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Sign in to vote." }, { status: 401 });
  const limited = await enforceLimit(req, "gym-review-helpful", POLICY.interaction, user.id);
  if (limited) return limited;
  const { reviewId } = await params;

  try {
    const result = await toggleHelpful(user.id, reviewId);
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Could not record your vote." }, { status: 400 });
  }
}
