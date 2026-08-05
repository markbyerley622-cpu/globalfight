import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { prisma } from "@/lib/db";
import { publicDisplayName } from "@/lib/display-name";
import { listFollows, getFollowCounts } from "@/lib/geo/people";
import { FollowList } from "@/components/profile/follow-list";
import { getCurrentUser } from "@/lib/auth";
import { searchFollowState } from "@/lib/search-follow";

async function loadUser(username: string) {
  return prisma.user.findUnique({
    where: { username },
    select: { id: true, name: true, username: true },
  });
}

export async function generateMetadata({ params }: { params: Promise<{ username: string }> }): Promise<Metadata> {
  const { username } = await params;
  const u = await loadUser(username);
  if (!u) return {};
  const who = publicDisplayName(u);
  return {
    title: `People ${who} follows`,
    description: `Everyone ${who} follows on Combat Reviews.`,
    alternates: { canonical: `/u/${u.username}/following` },
  };
}

export default async function FollowingPage({ params }: { params: Promise<{ username: string }> }) {
  const { username } = await params;
  const u = await loadUser(username);
  if (!u?.username) notFound();

  // The viewer is resolved BEFORE the list so their own follow state can be
  // batched with it — every row carries a Follow button now, and asking per row
  // would be one query per person on a page built to hold hundreds.
  const viewer = await getCurrentUser();
  const [people, counts] = await Promise.all([
    listFollows(u.id, "following"),
    getFollowCounts(u.id),
  ]);
  // searchFollowState is the ONE batched follow-state reader in the codebase
  // (built for the search overlay's five families). Only the `people` family is
  // asked for here; the others short-circuit on their empty key arrays, so this
  // is a single query.
  const follow = await searchFollowState(viewer?.id ?? null, {
    fighterSlugs: [], eventSlugs: [], gymSlugs: [], promotionSlugs: [],
    usernames: people.map((p) => p.username),
  });
  const who = publicDisplayName(u);

  return (
    <div className="container-cr max-w-xl py-8 md:py-12">
      <Link
        href={`/u/${u.username}`}
        className="inline-flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-fog transition-colors hover:text-chalk"
      >
        <ArrowLeft aria-hidden className="size-3.5" /> {who}
      </Link>

      <h1 className="mt-3 font-display text-2xl font-bold uppercase text-chalk md:text-3xl">Following</h1>

      <div className="mt-4 flex gap-2 border-b border-ink-800 pb-3">
        <Link
          href={`/u/${u.username}/followers`}
          className="rounded-lg px-3 py-1.5 text-xs font-semibold text-fog transition-colors hover:text-chalk"
        >
          {counts.followers.toLocaleString()} followers
        </Link>
        <span className="rounded-lg bg-blood-500/15 px-3 py-1.5 text-xs font-semibold text-blood-200">
          {counts.following.toLocaleString()} following
        </span>
      </div>

      {/* People only. This page is the USER graph; fighters, promotions and gyms a
          person follows are a different relationship (a subscription, not a social
          tie) and live in their own follow tables. Mixing them would make the count
          on the profile mean two things at once. */}
      <div className="mt-5">
        <FollowList
          people={people}
          direction="following"
          ownerName={who}
          following={follow.following.people}
          viewerUsername={viewer?.username ?? null}
        />
      </div>
    </div>
  );
}
