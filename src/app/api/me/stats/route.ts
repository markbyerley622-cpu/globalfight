import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { getProfileStats } from "@/lib/profile-stats";
import { getUserCards } from "@/lib/collectibles";
import { getUserActivity } from "@/lib/activity";

/** The identity payload for Profile 2.0: reputation/accuracy/streak/cards + a
 *  preview of recent cards and activity. */
export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ signedIn: false });
  const [stats, cards, activity] = await Promise.all([
    getProfileStats(user.id),
    getUserCards(user.id),
    getUserActivity(user.id, 12),
  ]);
  return NextResponse.json({ signedIn: true, stats, cards: cards.slice(0, 8), activity });
}

export const dynamic = "force-dynamic";
