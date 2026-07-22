import { NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentUser } from "@/lib/auth";
import { checkIn, checkOut, getPresence } from "@/lib/geo/presence";

const Body = z.object({
  gymId: z.string().min(1).optional(),
  eventId: z.string().min(1).optional(),
  note: z.string().max(80).optional(),
  action: z.enum(["in", "out"]),
}).refine((b) => !!b.gymId !== !!b.eventId, {
  message: "Check in to exactly one of a gym or an event.",
});

/** Check in / out of a gym or an event. */
export async function POST(req: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Sign in to check in." }, { status: 401 });

  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Bad request." }, { status: 400 });
  }
  const { gymId, eventId, note, action } = parsed.data;

  if (action === "out") {
    await checkOut({ userId: user.id, gymId, eventId });
  } else {
    await checkIn({ userId: user.id, gymId, eventId, note });
  }

  const presence = await getPresence({ gymId, eventId }, user.id);
  return NextResponse.json({ ok: true, presence });
}

export const dynamic = "force-dynamic";
