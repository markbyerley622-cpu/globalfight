import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { isPushConfigured, publicVapidKey } from "@/lib/push/send";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Body = z.object({
  endpoint: z.string().url().max(600),
  keys: z.object({ p256dh: z.string().min(1).max(200), auth: z.string().min(1).max(100) }),
});

/** The VAPID public key the browser needs before it can subscribe. */
export async function GET() {
  return NextResponse.json({ configured: isPushConfigured(), publicKey: publicVapidKey() });
}

/** Register this DEVICE. Upsert on endpoint: re-subscribing the same browser
 *  refreshes its keys instead of accumulating dead rows. */
export async function POST(req: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Sign in." }, { status: 401 });
  if (!isPushConfigured()) {
    return NextResponse.json({ error: "Push is not configured on this server." }, { status: 503 });
  }

  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Bad subscription." }, { status: 400 });
  const { endpoint, keys } = parsed.data;

  await prisma.pushSubscription.upsert({
    where: { endpoint },
    // An endpoint can legitimately move between accounts (shared device), so
    // update takes ownership rather than refusing.
    create: {
      userId: user.id, endpoint, p256dh: keys.p256dh, auth: keys.auth,
      userAgent: req.headers.get("user-agent")?.slice(0, 200) ?? null,
    },
    update: { userId: user.id, p256dh: keys.p256dh, auth: keys.auth, failedCount: 0 },
  });

  return NextResponse.json({ ok: true });
}

/** Unsubscribe this device. */
export async function DELETE(req: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Sign in." }, { status: 401 });
  const endpoint = new URL(req.url).searchParams.get("endpoint");
  if (!endpoint) return NextResponse.json({ error: "Which device?" }, { status: 400 });
  // Scoped to the caller: an endpoint string must not let one user unsubscribe
  // another's device.
  await prisma.pushSubscription.deleteMany({ where: { endpoint, userId: user.id } });
  return NextResponse.json({ ok: true });
}
