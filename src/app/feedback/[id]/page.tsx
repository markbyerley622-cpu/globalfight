import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { getCurrentUser } from "@/lib/auth";
import { getFeedback, CATEGORY_LABEL, STATUS_LABEL, STATUS_TONE, isCategory, isStatus } from "@/lib/feedback";
import { FeedbackCard } from "@/components/feedback/feedback-card";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  const item = await getFeedback(id);
  if (!item) return { title: "Feedback" };
  return {
    title: item.title,
    description: item.body.slice(0, 160),
  };
}

/**
 * One feedback item.
 *
 * Comments are deliberately absent from v1. The board's job is to show what
 * people want and how many agree; a discussion thread under every idea is a
 * second forum to moderate, and the product already has one.
 */
export default async function FeedbackDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await getCurrentUser();
  // A hidden item is indistinguishable from one that never existed — the same
  // uniform-404 rule the rest of the product uses, so this page is not a way to
  // confirm what moderation removed.
  const item = await getFeedback(id, user?.id ?? null);
  if (!item) notFound();

  const category = isCategory(item.category) ? CATEGORY_LABEL[item.category] : item.category;
  const status = isStatus(item.status) ? STATUS_LABEL[item.status] : item.status;
  const tone = isStatus(item.status) ? STATUS_TONE[item.status] : "neutral";
  const fmt = (d: Date) => new Date(d).toLocaleDateString(undefined, { day: "numeric", month: "long", year: "numeric" });

  return (
    <div className="container-cr max-w-3xl py-6">
      <Link href="/feedback" className="tap mb-4 inline-flex items-center gap-1.5 text-2xs font-bold uppercase tracking-wide text-fog transition-colors hover:text-chalk">
        <ArrowLeft className="size-3.5" aria-hidden /> Back to the board
      </Link>

      {/* The card carries the vote control, so the detail page and the board
          can never disagree about what a vote looks like or how it behaves. */}
      <FeedbackCard item={item} canVote={Boolean(user)} />

      <section className="mt-5 rounded-card border border-ink-800 bg-ink-900 p-5">
        <h1 className="font-display text-lg font-black leading-tight text-chalk">{item.title}</h1>
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          <Badge tone="outline" size="sm">{category}</Badge>
          <Badge tone={tone} size="sm">{status}</Badge>
        </div>
        <p className="mt-4 whitespace-pre-wrap text-sm leading-relaxed text-mist">{item.body}</p>

        {item.publicNote && (
          <div className="mt-5 rounded-lg border border-volt-500/30 bg-volt-500/5 p-3.5">
            <p className="font-display text-3xs font-bold uppercase tracking-[0.16em] text-volt-300">
              From the team
            </p>
            <p className="mt-1 text-sm text-mist">{item.publicNote}</p>
          </div>
        )}

        <dl className="mt-5 flex flex-wrap gap-x-6 gap-y-1 border-t border-ink-800 pt-4 text-2xs text-fog">
          <div className="flex gap-1.5">
            <dt>Posted by</dt>
            <dd className="text-mist">
              {item.author?.username ? (
                <Link href={`/u/${item.author.username}`} className="hover:text-chalk">@{item.author.username}</Link>
              ) : (
                "a former member"
              )}
            </dd>
          </div>
          <div className="flex gap-1.5"><dt>Created</dt><dd className="text-mist">{fmt(item.createdAt)}</dd></div>
          <div className="flex gap-1.5"><dt>Updated</dt><dd className="text-mist">{fmt(item.updatedAt)}</dd></div>
          {item.resolvedAt && (
            <div className="flex gap-1.5"><dt>Resolved</dt><dd className="text-mist">{fmt(item.resolvedAt)}</dd></div>
          )}
        </dl>
      </section>
    </div>
  );
}
