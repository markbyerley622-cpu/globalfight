import "server-only";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { isAdminRole } from "@/lib/admin/guard";

// ════════════════════════════════════════════════════════════════════════════
//  "May this request change this gym?" — asked once, in one place.
//
//  Three routes now mutate a gym (details, images, photos). Three copies of the
//  ownership check is three places for one of them to be written slightly
//  wrong, and the wrong one is a stranger editing somebody's business page.
//
//  The check reads Gym.ownerId from the DATABASE and compares it to the
//  session user. It never trusts a role, a flag or an id supplied by the
//  client — the request body cannot influence the answer.
// ════════════════════════════════════════════════════════════════════════════

export interface GymAuthOk {
  gym: { id: string; slug: string; name: string; ownerId: string | null; logoUrl: string | null; heroUrl: string | null };
  userId: string;
}

export async function authoriseGymEdit(
  slug: string,
): Promise<{ ok: true; value: GymAuthOk } | { ok: false; response: NextResponse }> {
  const user = await getCurrentUser();
  if (!user) {
    return { ok: false, response: NextResponse.json({ error: "Sign in." }, { status: 401 }) };
  }

  const gym = await prisma.gym.findUnique({
    where: { slug },
    select: { id: true, slug: true, name: true, ownerId: true, logoUrl: true, heroUrl: true },
  });
  if (!gym) {
    return { ok: false, response: NextResponse.json({ error: "No such gym." }, { status: 404 }) };
  }

  if (gym.ownerId !== user.id && !isAdminRole(user.role)) {
    return {
      ok: false,
      response: NextResponse.json({ error: "You don't manage this gym." }, { status: 403 }),
    };
  }

  return { ok: true, value: { gym, userId: user.id } };
}
