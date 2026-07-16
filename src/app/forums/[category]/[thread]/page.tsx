import type { Metadata } from "next";
import { notFound } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, Eye, MessageSquare, Heart } from "lucide-react";
import { PageHero } from "@/components/page-hero";
import { ThreadDiscussion } from "@/components/forums/thread-discussion";
import { ThreadEngagement } from "@/components/forums/thread-engagement";
import { KindBadge } from "@/components/forums/kind-badge";
import { getThread } from "@/lib/forum/repo";
import { getSessionUserId } from "@/lib/auth";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ thread: string }> }): Promise<Metadata> {
  const { thread } = await params;
  const t = await getThread(thread);
  return t ? { title: t.title, description: `${t.title} — ${t.categoryName} discussion on Combat Register.` } : {};
}

export default async function ThreadPage({ params }: { params: Promise<{ category: string; thread: string }> }) {
  const { thread } = await params;
  const viewerId = (await getSessionUserId()) ?? undefined;
  const t = await getThread(thread, { incrementViews: true, viewerId });
  if (!t) notFound();

  return (
    <>
      <PageHero eyebrow={t.categoryName} title={t.title}>
        <p className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-mist">
          <KindBadge kind={t.kind} />
          <span>by {t.authorName}</span>
          <span className="flex items-center gap-1"><MessageSquare className="size-3.5" />{t.replyCount} replies</span>
          <span className="flex items-center gap-1"><Eye className="size-3.5" />{t.views} views</span>
          {t.reactionCount > 0 && <span className="flex items-center gap-1"><Heart className="size-3.5" />{t.reactionCount}</span>}
        </p>
      </PageHero>

      <div className="container-cr max-w-3xl py-10">
        <Link href={`/forums/${t.categorySlug}`} className="mb-4 inline-flex items-center gap-1.5 text-sm text-mist hover:text-blood-400">
          <ArrowLeft className="size-4" /> Back to {t.categoryName}
        </Link>

        <div className="card-surface mb-4 p-3 sm:p-4">
          <ThreadEngagement thread={t} />
        </div>

        <ThreadDiscussion threadSlug={t.slug} locked={t.locked} threadAuthorId={t.authorId} categorySlug={t.categorySlug} />
      </div>
    </>
  );
}
