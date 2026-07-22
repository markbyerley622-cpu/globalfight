import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ChevronLeft, BadgeCheck } from "lucide-react";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { isAdminRole } from "@/lib/admin/guard";
import { GymManageForm } from "@/components/map/gym-manage-form";

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
      website: true, instagram: true, phone: true, email: true, hoursNote: true,
      disciplines: true, verified: true, memberCount: true, ownerId: true,
      logoUrl: true, heroUrl: true,
    },
  });
  if (!gym) notFound();
  if (gym.ownerId !== user.id && !isAdminRole(user.role)) notFound();

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
        You manage {gym.name}. Changes are live immediately and save as you go.
      </p>

      <div className="mt-5">
        <GymManageForm gym={gym} />
      </div>
    </div>
  );
}
