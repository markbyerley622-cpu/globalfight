import type { Metadata } from "next";
import Link from "next/link";
import { MessageSquare, Users } from "lucide-react";
import { PageHero } from "@/components/page-hero";
import { CategoryIcon } from "@/components/category-icon";
import { JoinButton } from "@/components/community/join-button";
import { getCommunities } from "@/lib/community/repo";
import { getSessionUserId } from "@/lib/auth";

export const metadata: Metadata = {
  title: "Communities",
  description: "Join a combat-sports community — MMA, Boxing, Muay Thai, BJJ, Wrestling and more. Discuss fights, share clips and follow the conversation in realtime.",
};

export const dynamic = "force-dynamic";

export default async function CommunityDirectoryPage() {
  const viewerId = (await getSessionUserId()) ?? undefined;
  const communities = await getCommunities(viewerId);

  return (
    <>
      <PageHero
        eyebrow="The community"
        title="Communities"
        description="Every combat sport, one home. Join a community to discuss fights, share clips and follow the conversation — realtime across every device."
      />

      <div className="container-cr max-w-5xl py-8">
        <div className="grid gap-3 sm:grid-cols-2">
          {communities.map((c) => (
            <div key={c.slug} className="card-surface flex flex-col gap-3 p-4">
              <div className="flex items-start gap-3">
                <span className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-ink-800 text-blood-400">
                  <CategoryIcon name={c.slug} className="size-5" />
                </span>
                <div className="min-w-0 flex-1">
                  <Link href={`/community/${c.slug}`} className="block font-display text-base font-bold text-chalk hover:text-blood-300">
                    {c.name}
                  </Link>
                  {c.description && <p className="mt-0.5 line-clamp-2 text-xs leading-relaxed text-fog">{c.description}</p>}
                </div>
              </div>
              <div className="flex items-center justify-between gap-3 border-t border-ink-800 pt-3">
                <div className="flex items-center gap-3 text-[0.7rem] text-fog">
                  <span className="flex items-center gap-1"><Users className="size-3.5" />{c.memberCount.toLocaleString()}</span>
                  <span className="flex items-center gap-1"><MessageSquare className="size-3.5" />{c.threadCount}</span>
                </div>
                <JoinButton slug={c.slug} initialIsMember={c.isMember} initialMemberCount={c.memberCount} size="sm" />
              </div>
            </div>
          ))}
        </div>
      </div>
    </>
  );
}
