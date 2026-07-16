import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { getCurrentUser } from "@/lib/auth";
import { getFighterPublicProfile } from "@/lib/fighters/profile";
import { FighterManager } from "@/components/fighters/fighter-manager";
import { PageHero } from "@/components/page-hero";

export const metadata = { robots: { index: false } };
export const dynamic = "force-dynamic";

export default async function ManageProfilePage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const user = await getCurrentUser();
  if (!user) redirect("/account");

  const profile = await getFighterPublicProfile(slug);
  if (!profile) notFound();

  if (profile.ownerId !== user.id) {
    return (
      <>
        <PageHero eyebrow="Manage" title="Not your profile" />
        <div className="container-cr py-16 text-center text-sm text-fog">
          You can only manage a profile you own. <Link href={`/fighters/${slug}`} className="text-blood-400">Back to profile</Link>
        </div>
      </>
    );
  }

  return (
    <>
      <PageHero eyebrow="Your website" title={`Manage — ${profile.name}`} description="Everything here publishes to your public profile instantly.">
        <Link href={`/fighters/${slug}`} className="rounded-lg border border-ink-700 px-3.5 py-2 font-display text-xs font-semibold uppercase tracking-wide text-mist hover:text-chalk">View public page →</Link>
      </PageHero>
      <div className="container-cr py-10">
        <FighterManager slug={slug} initial={profile} />
      </div>
    </>
  );
}
