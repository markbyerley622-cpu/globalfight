import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { prisma } from "@/lib/db";
import { PRESENCE_SELECT } from "@/lib/presence/select";
import { presenceDtoFor } from "@/lib/presence/policy";
import { publicDisplayName } from "@/lib/display-name";
import { getCurrentUser } from "@/lib/auth";
import { searchFollowState } from "@/lib/search-follow";
import { FollowList } from "@/components/profile/follow-list";
import type { FollowListPerson } from "@/lib/geo/people";

/**
 * WHO FOLLOWS THIS GYM.
 *
 * The gym page already showed "3 followers" as plain text — a count with no way
 * to open it, which is the same "decoration, not a link" problem the user
 * profiles had before their counts became links. A gym's following is its
 * community; being able to see who is in it is most of the point of following
 * one.
 *
 * Reuses FollowList — the SAME component the user followers/following pages
 * render, so a row looks and behaves identically wherever a list of people
 * appears, including the batched Follow button.
 */
async function loadGym(slug: string) {
  return prisma.gym.findUnique({ where: { slug }, select: { id: true, name: true, slug: true } });
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const gym = await loadGym(slug);
  if (!gym) return {};
  return {
    title: `People following ${gym.name}`,
    description: `Everyone following ${gym.name} on Combat Reviews.`,
    alternates: { canonical: `/gyms/${gym.slug}/followers` },
  };
}

export default async function GymFollowersPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const gym = await loadGym(slug);
  if (!gym) notFound();

  const viewer = await getCurrentUser();

  // Gym follows live in the polymorphic Follow table (targetType "gym"), not in
  // UserFollow — so this reads Follow and then resolves the people, rather than
  // reusing listFollows, which is user-to-user only.
  const rows = await prisma.follow.findMany({
    where: { targetType: "gym", targetId: gym.id },
    orderBy: { createdAt: "desc" },
    take: 200,
    select: {
      user: { select: { name: true, username: true, image: true, reputation: true, ...PRESENCE_SELECT } },
    },
  });

  // Only members with a public handle: a follower with no username has no
  // /u/<handle> page, so a row for them would be a link to nowhere.
  const people: FollowListPerson[] = rows.flatMap((r) =>
    r.user.username
      ? [{
          username: r.user.username,
          name: publicDisplayName(r.user),
          image: r.user.image,
          reputation: r.user.reputation,
          presence: presenceDtoFor(r.user, viewer?.id ?? null),
        }]
      : [],
  );

  const follow = await searchFollowState(viewer?.id ?? null, {
    fighterSlugs: [], eventSlugs: [], gymSlugs: [], promotionSlugs: [],
    usernames: people.map((p) => p.username),
  });

  return (
    <div className="container-cr max-w-xl py-8 md:py-12">
      <Link
        href={`/gyms/${gym.slug}`}
        className="inline-flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-fog transition-colors hover:text-chalk"
      >
        <ArrowLeft aria-hidden className="size-3.5" /> {gym.name}
      </Link>

      <h1 className="mt-3 font-display text-2xl font-bold uppercase text-chalk md:text-3xl">Followers</h1>
      <p className="mt-1 text-sm text-fog">
        {people.length.toLocaleString()} {people.length === 1 ? "person follows" : "people follow"} {gym.name}.
      </p>

      <div className="mt-5">
        <FollowList
          people={people}
          direction="followers"
          ownerName={gym.name}
          following={follow.following.people}
          viewerUsername={viewer?.username ?? null}
        />
      </div>
    </div>
  );
}

export const dynamic = "force-dynamic";
