import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ChevronLeft, BadgeCheck } from "lucide-react";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { isAdminRole } from "@/lib/admin/guard";
import { GymDashboard } from "@/components/map/gym-dashboard";

export const metadata: Metadata = { title: "Manage gym", robots: { index: false } };
export const dynamic = "force-dynamic";

/**
 * The owner dashboard. Reachable only by the gym's owner (or an admin) — the
 * route itself enforces it, not just the link that points here.
 */
export default async function ManageGymPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const user = await getCurrentUser().catch(() => null);
  if (!user) redirect("/account");

  const gym = await prisma.gym.findUnique({
    where: { slug },
    select: {
      id: true, slug: true, name: true, description: true, address: true, city: true, country: true,
      website: true, instagram: true, facebook: true, youtube: true, tiktok: true,
      phone: true, email: true, hoursNote: true,
      disciplines: true, verified: true, memberCount: true, ownerId: true,
      logoUrl: true, heroUrl: true,
    },
  });
  if (!gym) notFound();
  if (gym.ownerId !== user.id && !isAdminRole(user.role)) notFound();

  const weekAgo = new Date(Date.now() - 7 * 86_400_000);
  const [photos, roster, presentNow, checkInsWeek, pendingClaims] = await Promise.all([
    prisma.gymPhoto.findMany({
      where: { gymId: gym.id },
      orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
      select: { id: true, url: true, thumbUrl: true, width: true, height: true, caption: true },
    }),
    prisma.gymMember.findMany({
      where: { gymId: gym.id },
      orderBy: [{ role: "asc" }, { createdAt: "asc" }],
      select: {
        id: true, role: true, isHome: true, createdAt: true,
        user: { select: { id: true, name: true, username: true, image: true, registryRole: true, reputation: true } },
      },
    }),
    prisma.checkIn.count({ where: { gymId: gym.id, expiresAt: { gt: new Date() } } }),
    prisma.checkIn.count({ where: { gymId: gym.id, createdAt: { gte: weekAgo } } }),
    // Claims by anyone OTHER than the current owner still sitting in review.
    prisma.gymClaim.count({
      where: { gymId: gym.id, status: { in: ["pending", "info_requested"] }, claimantId: { not: gym.ownerId ?? "" } },
    }),
  ]);

  const members = roster.map((m) => ({
    id: m.id,
    role: m.role,
    isHome: m.isHome,
    joinedAt: m.createdAt.toISOString(),
    user: m.user,
  }));

  return (
    <div className="mx-auto w-full max-w-2xl px-4 pb-16 pt-5 lg:max-w-3xl">
      <Link
        href={`/gyms/${gym.slug}`}
        className="mb-3 inline-flex items-center gap-1 text-[0.72rem] font-semibold uppercase tracking-wide text-fog hover:text-chalk"
      >
        <ChevronLeft className="size-3.5" /> {gym.name}
      </Link>

      <h1 className="flex items-center gap-2 font-display text-2xl font-black uppercase tracking-tight text-chalk">
        Manage gym
        {gym.verified && <BadgeCheck className="size-5 text-volt-400" />}
      </h1>
      <p className="mt-1 text-sm text-fog">
        You manage {gym.name}. Everything here is live — changes save as you go.
      </p>

      <div className="mt-5">
        <GymDashboard
          data={{ gym, photos, members, ownerId: gym.ownerId, presentNow, checkInsWeek, pendingClaims }}
        />
      </div>
    </div>
  );
}
