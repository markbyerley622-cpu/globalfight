import type { Metadata } from "next";
import { notFound } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, MessageSquare, Users } from "lucide-react";
import { PageHero } from "@/components/page-hero";
import { CategoryIcon } from "@/components/category-icon";
import { JoinButton } from "@/components/community/join-button";
import { ThreadList } from "@/components/forums/thread-list";
import { getCommunity } from "@/lib/community/repo";
import { getForumCategories } from "@/lib/forum/repo";
import { getSessionUserId } from "@/lib/auth";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const c = await getCommunity(slug);
  return c ? { title: `${c.name} — Community`, description: c.description ?? undefined } : {};
}

export default async function CommunityPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const viewerId = (await getSessionUserId()) ?? undefined;
  const [community, categories] = await Promise.all([getCommunity(slug, viewerId), getForumCategories()]);
  if (!community) notFound();

  return (
    <>
      <PageHero eyebrow="Community" title={community.name} description={community.description ?? undefined}>
        <div className="flex flex-wrap items-center gap-4">
          <JoinButton slug={community.slug} initialIsMember={community.isMember} initialMemberCount={community.memberCount} />
          <div className="flex items-center gap-4 text-xs text-mist">
            <span className="flex items-center gap-1.5"><Users className="size-4" />{community.memberCount.toLocaleString()} member{community.memberCount === 1 ? "" : "s"}</span>
            <span className="flex items-center gap-1.5"><MessageSquare className="size-4" />{community.threadCount} thread{community.threadCount === 1 ? "" : "s"}</span>
          </div>
        </div>
      </PageHero>

      <div className="container-cr max-w-4xl py-10">
        <Link href="/community" className="mb-4 inline-flex items-center gap-1.5 text-sm text-mist hover:text-blood-400">
          <ArrowLeft className="size-4" /> All communities
        </Link>
        <div className="mb-3 flex items-center gap-2.5">
          <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-ink-800 text-blood-400">
            <CategoryIcon name={community.slug} className="size-4" />
          </span>
          <h2 className="font-display text-lg font-bold text-chalk">Discussions</h2>
        </div>
        <ThreadList categorySlug={community.slug} categories={categories} />
      </div>
    </>
  );
}
