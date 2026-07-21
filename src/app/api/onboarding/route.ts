import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { saveOnboarding, completeOnboarding, getOnboardingOptions } from "@/lib/onboarding";

const asStrings = (v: unknown): string[] | undefined =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === "string").slice(0, 50) : undefined;

/** Options for the next step, narrowed by the sports chosen so far. */
export async function GET(req: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  const sports = new URL(req.url).searchParams.get("sports");
  return NextResponse.json(await getOnboardingOptions(sports ? sports.split(",").filter(Boolean) : []));
}

/** Persist a step. Called on every transition so progress is never lost. */
export async function PATCH(req: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Invalid request." }, { status: 400 }); }

  await saveOnboarding(user.id, {
    role: typeof body.role === "string" ? body.role : undefined,
    sports: asStrings(body.sports),
    promotions: asStrings(body.promotions),
    fighters: asStrings(body.fighters),
  });
  return NextResponse.json({ ok: true });
}

/** Finish or skip — auto-follows the cards the user's choices imply. */
export async function POST() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  return NextResponse.json(await completeOnboarding(user.id));
}

export const dynamic = "force-dynamic";
