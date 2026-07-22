import type { Metadata } from "next";
import { notFound } from "next/navigation";
import Link from "next/link";
import { prisma } from "@/lib/db";
import { GymClaimForm } from "@/components/map/gym-claim-form";

export const metadata: Metadata = { title: "Claim a gym", robots: { index: false } };
export const dynamic = "force-dynamic";

export default async function ClaimGymPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const gym = await prisma.gym.findUnique({
    where: { slug },
    select: { name: true, slug: true, city: true, country: true, ownerId: true },
  });
  if (!gym) notFound();

  if (gym.ownerId) {
    return (
      <div className="mx-auto w-full max-w-lg px-4 py-16 text-center">
        <h1 className="font-display text-xl font-black uppercase text-chalk">Already claimed</h1>
        <p className="mt-2 text-sm text-fog">
          {gym.name} is already managed by its owner. If that&apos;s wrong, contact us from the gym page.
        </p>
        <Link href={`/gyms/${gym.slug}`} className="mt-4 inline-flex text-sm font-semibold text-blood-300 underline-offset-2 hover:underline">
          Back to {gym.name}
        </Link>
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-lg px-4 pb-16 pt-6">
      <p className="eyebrow">Ownership</p>
      <h1 className="mt-1.5 font-display text-2xl font-black uppercase tracking-tight text-chalk">
        Claim {gym.name}
      </h1>
      <p className="mt-1.5 text-sm leading-relaxed text-fog">
        Claiming lets you manage this page — details, photos, classes and coaches. Tell us how we can confirm you
        represent {gym.name}
        {gym.city ? ` in ${gym.city}` : ""}. A human reviews every claim; nothing changes until it&apos;s approved.
      </p>
      <GymClaimForm slug={gym.slug} gymName={gym.name} />
    </div>
  );
}
