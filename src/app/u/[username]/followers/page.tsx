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
    title: `People following ${who}`,
    description: `Everyone following ${who} on Combat Reviews.`,
    alternates: { canonical: `/u/${u.username}/followers` },
  };
}

export default async function FollowersPage({ params }: { params: Promise<{ username: string }> }) {
  const { username } = await params;
  const u = await loadUser(username);
  if (!u?.username) notFound();

  // The viewer is resolved BEFORE the list so their own follow state can be
  // batched with it — every row carries a Follow button now, and asking per row
  // would be one query per person on a page built to hold hundreds.
  const viewer = await getCurrentUser();
  const [people, counts] = await Promise.all([
    listFollows(u.id, "followers"),
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

      <h1 className="mt-3 font-display text-2xl font-bold uppercase text-chalk md:text-3xl">Followers</h1>

      {/* Both directions are reachable from either page — a reader who lands on
          followers usually wants to compare it against following. */}
      <div className="mt-4 flex gap-2 border-b border-ink-800 pb-3">
        <span className="rounded-lg bg-blood-500/15 px-3 py-1.5 text-xs font-semibold text-blood-200">
          {counts.followers.toLocaleString()} followers
        </span>
        <Link
          href={`/u/${u.username}/following`}
          className="rounded-lg px-3 py-1.5 text-xs font-semibold text-fog transition-colors hover:text-chalk"
        >
          {counts.following.toLocaleString()} following
        </Link>
      </div>

      <div className="mt-5">
        <FollowList
          people={people}
          direction="followers"
          ownerName={who}
          following={follow.following.people}
          viewerUsername={viewer?.username ?? null}
        />
      </div>
    </div>
  );
}
