import type { Metadata } from "next";
import { notFound } from "next/navigation";
import Image from "next/image";
import Link from "next/link";
import { Trophy, Target, Flame, ListChecks, TrendingUp } from "lucide-react";
import { prisma } from "@/lib/db";
import { getTrainingNowFor } from "@/lib/geo/presence";
import { getProfileStats } from "@/lib/profile-stats";
import { getUserActivity } from "@/lib/activity";
import { Badge } from "@/components/ui/badge";
import { ButtonLink } from "@/components/ui/button";
import { BackButton } from "@/components/back-button";
import { ShareMenu } from "@/components/share-menu";
import { timeAgo } from "@/lib/utils";
import { publicDisplayName } from "@/lib/display-name";
import { getFollowCounts, getMutualFollowers } from "@/lib/geo/people";
import { getCurrentUser } from "@/lib/auth";
import { isFollowing } from "@/lib/follow-targets";
import { FollowButton } from "@/components/follow-button";
import { MessageButton } from "@/components/messages/message-button";

const ROLE_LABEL: Record<string, string> = {
  fighter: "Fighter", coach: "Coach", gym: "Gym", promoter: "Promoter",
  manager: "Manager", official: "Official", media: "Media",
};

function initials(name: string): string {
  return name.trim().split(/\s+/).slice(0, 2).map((w) => w[0]?.toUpperCase() ?? "").join("") || "?";
}

async function loadUser(username: string) {
  return prisma.user.findUnique({
    where: { username },
    select: { id: true, name: true, username: true, image: true, bannerUrl: true, bio: true, registryRole: true, createdAt: true },
  });
}

export async function generateMetadata({ params }: { params: Promise<{ username: string }> }): Promise<Metadata> {
  const { username } = await params;
  const u = await loadUser(username);
  if (!u?.username) return {};
  const stats = await getProfileStats(u.id);
  const who = publicDisplayName(u);
  const desc = stats && stats.picksResolved
    ? `${who} — ${stats.reputation.toLocaleString()} reputation · ${stats.accuracy}% accuracy · best ${stats.bestPickStreak}-fight streak on Combat Reviews.`
    : `${who} on Combat Reviews.`;
  return { title: who, description: desc, alternates: { canonical: `/u/${u.username}` } };
}

export default async function PublicProfile({ params }: { params: Promise<{ username: string }> }) {
  const { username } = await params;
  const u = await loadUser(username);
  if (!u?.username) notFound();

  // Resolved first: the follow state and the mutuals both depend on who is
  // looking, and both belong in the wave below rather than after it.
  const viewer = await getCurrentUser();
  const isSelf = viewer?.id === u.id;

  const [stats, activity, rankedTotal, trainingNow, followCounts, viewerFollows, mutuals] = await Promise.all([
    getProfileStats(u.id),
    getUserActivity(u.id, 8),
    prisma.user.count({ where: { picksResolved: { gt: 0 } } }),
    // Live gym check-in. Derived from CheckIn rather than a stored status
    // field, so it cannot disagree with the check-in that produced it and it
    // expires on its own.
    getTrainingNowFor(u.id),
    // Added to the EXISTING parallel wave rather than a new round-trip.
    getFollowCounts(u.id),
    viewer && !isSelf ? isFollowing(viewer.id, { type: "person", id: u.id }) : Promise.resolve(false),
    getMutualFollowers(viewer?.id, u.id),
  ]);

  const displayName = publicDisplayName(u);
  const rep = stats?.reputation ?? 0;
  const acc = stats?.accuracy ?? 0;
  const streak = stats?.pickStreak ?? 0;
  const bestStreak = stats?.bestPickStreak ?? 0;
  const resolved = stats?.picksResolved ?? 0;
  const correct = stats?.picksCorrect ?? 0;
  const rank = stats?.rank ?? null;
  const percentile = rank && rankedTotal ? Math.max(1, Math.round((rank / rankedTotal) * 100)) : null;
  const roleLabel = ROLE_LABEL[u.registryRole];

  // Status chips — only what's actually true, so the profile earns its respect.
  const chips: { icon: React.ReactNode; label: string; tone: "gold" | "red" | "volt" | "neutral" }[] = [];
  // Training-now leads: it is the only chip that is true THIS MINUTE.
  if (trainingNow) {
    chips.push({ icon: <Flame className="size-3" />, label: `Training at ${trainingNow.gymName}`, tone: "red" });
  }
  if (rank) chips.push({ icon: <Trophy className="size-3" />, label: `#${rank.toLocaleString()}`, tone: "gold" });
  if (percentile && percentile <= 25) chips.push({ icon: <TrendingUp className="size-3" />, label: `Top ${percentile}%`, tone: "gold" });
  if (streak >= 3) chips.push({ icon: <Flame className="size-3" />, label: `${streak}-fight streak`, tone: "red" });
  else if (bestStreak >= 5) chips.push({ icon: <Flame className="size-3" />, label: `Best ${bestStreak} streak`, tone: "neutral" });
  if (resolved >= 5) chips.push({ icon: <Target className="size-3" />, label: `${acc}% accuracy`, tone: "volt" });
  if (roleLabel) chips.push({ icon: null, label: roleLabel, tone: "neutral" });

  return (
    <div className="pb-16">
      {/* Banner */}
      <div className="relative h-32 w-full sm:h-44">
        {u.bannerUrl ? (
          <Image src={u.bannerUrl} alt="" fill className="object-cover" unoptimized />
        ) : (
          <div className="size-full bg-gradient-to-br from-blood-900/60 via-ink-900 to-ink-950" />
        )}
        <div className="absolute inset-x-0 bottom-0 h-16 bg-gradient-to-t from-ink-950 to-transparent" />
        <BackButton fallback="/following" className="absolute left-4 top-[calc(0.75rem+env(safe-area-inset-top))] z-10" />
      </div>

      <div className="container-cr">
        {/* Identity */}
        <div className="-mt-12 flex flex-col items-center gap-3 text-center sm:-mt-14 sm:flex-row sm:items-end sm:gap-5 sm:text-left">
          <div className="size-24 shrink-0 overflow-hidden rounded-full ring-4 ring-ink-950 sm:size-28">
            {u.image ? (
              <Image src={u.image} alt={displayName} width={112} height={112} className="size-full object-cover" unoptimized />
            ) : (
              <span className="flex size-full items-center justify-center bg-gradient-to-br from-blood-500 to-blood-800 font-display text-3xl font-black text-white">
                {initials(displayName)}
              </span>
            )}
          </div>
          <div className="min-w-0 flex-1 pb-1">
            <h1 className="truncate font-display text-2xl font-black text-chalk sm:text-3xl">{displayName}</h1>
            <p className="text-sm text-fog">@{u.username} · joined {u.createdAt.toLocaleDateString(undefined, { month: "short", year: "numeric" })}</p>
          </div>
          {/* Reputation headline */}
          <div className="shrink-0 card-surface px-5 py-3 text-center">
            <p className="inline-flex items-center gap-1.5 font-display text-2xl font-black tabular-nums text-chalk">
              <Trophy className="size-5 text-gold-400" /> {rep.toLocaleString()}
            </p>
            <p className="text-3xs uppercase tracking-wider text-fog">Reputation</p>
          </div>
        </div>

        {/* SOCIAL PROOF. The profile led with prediction stats and showed nothing
            about the person's standing in the community — so following someone was
            a capability with no visible consequence anywhere. Followers first,
            because it is the number that tells a stranger whether this person is
            worth reading. Both counts are LINKS: a count you cannot open is
            decoration. */}
        <div className="mt-4 flex flex-wrap items-center justify-center gap-2 sm:justify-start">
          <Link
            href={`/u/${u.username}/followers`}
            className="tap inline-flex items-baseline gap-1.5 rounded-lg border border-ink-800 bg-ink-900 px-3 py-1.5 transition-colors hover:border-ink-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blood-400"
          >
            <span className="font-display text-sm font-bold tabular-nums text-chalk">
              {followCounts.followers.toLocaleString()}
            </span>
            <span className="text-2xs uppercase tracking-wide text-fog">Followers</span>
          </Link>
          <Link
            href={`/u/${u.username}/following`}
            className="tap inline-flex items-baseline gap-1.5 rounded-lg border border-ink-800 bg-ink-900 px-3 py-1.5 transition-colors hover:border-ink-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blood-400"
          >
            <span className="font-display text-sm font-bold tabular-nums text-chalk">
              {followCounts.following.toLocaleString()}
            </span>
            <span className="text-2xs uppercase tracking-wide text-fog">Following</span>
          </Link>

          {/* THE ACTION. Both counts were here and the button was not, so a
              visitor could see that a person had followers and had no way to
              become one — the counts advertised a capability the page did not
              offer. Not rendered on your own profile: self-follow is refused by
              the API, so a button there is a guaranteed dead end. */}
          {!isSelf && (
            <>
              <FollowButton
                kind="person"
                slug={u.username}
                name={displayName}
                initialFollowing={viewerFollows}
                size="sm"
              />
              {/* A conversation starts HERE and nowhere else — there is no
                  "compose" screen with a recipient picker, because that is the
                  shape that makes unsolicited messaging easy. */}
              <MessageButton username={u.username} name={displayName} />
            </>
          )}
        </div>

        {/* Social proof that survives scrutiny. A raw follower count reads the
            same for a respected analyst and for a bought audience; "followed by
            people you follow" is the one signal that cannot be gamed against a
            specific viewer. Needs no new table — it is an intersection of
            UserFollow with itself. */}
        {mutuals.count > 0 && (
          <p className="mt-2 text-center text-xs text-fog sm:text-left">
            Followed by{" "}
            {mutuals.sample.map((m, i) => (
              <span key={m.username ?? i}>
                {i > 0 && (i === mutuals.sample.length - 1 ? " and " : ", ")}
                {m.username ? (
                  <Link href={`/u/${m.username}`} className="font-semibold text-mist hover:text-blood-300 hover:underline">
                    {publicDisplayName(m)}
                  </Link>
                ) : (
                  <span className="font-semibold text-mist">{publicDisplayName(m)}</span>
                )}
              </span>
            ))}
            {mutuals.count > mutuals.sample.length && (
              <> and {(mutuals.count - mutuals.sample.length).toLocaleString()} other
                {mutuals.count - mutuals.sample.length === 1 ? "" : "s"}</>
            )}
            {" "}you follow
          </p>
        )}

        {/* Status chips */}
        {chips.length > 0 && (
          <div className="mt-4 flex flex-wrap justify-center gap-2 sm:justify-start">
            {chips.map((c, i) => (
              <Badge key={i} tone={c.tone}>{c.icon}{c.label}</Badge>
            ))}
          </div>
        )}

        {/* Bio */}
        {u.bio && <p className="mt-4 max-w-2xl text-center text-sm text-mist sm:text-left">{u.bio}</p>}

        {/* Stat tiles */}
        <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Tile icon={<Target className="size-4 text-volt-400" />} label="Accuracy" value={resolved ? `${acc}%` : "—"} sub={resolved ? `${stats?.picksCorrect}/${resolved} calls` : "no calls yet"} />
          <Tile icon={<Flame className="size-4 text-blood-400" />} label="Best streak" value={bestStreak ? String(bestStreak) : "—"} sub={streak >= 2 ? `${streak} live now` : "consecutive"} />
          <Tile icon={<ListChecks className="size-4 text-volt-400" />} label="Predictions" value={resolved ? String(resolved) : "—"} sub={resolved ? `${correct} correct` : "no calls yet"} />
          <Tile icon={<Trophy className="size-4 text-gold-400" />} label="Rank" value={rank ? `#${rank}` : "—"} sub={percentile ? `top ${percentile}%` : "unranked"} />
        </div>

        {/* Recent activity */}
        <Section title="Recent form">
          {activity.length === 0 ? (
            <Empty>Nothing to show yet — their picks will appear here.</Empty>
          ) : (
            <ul className="divide-y divide-ink-800 overflow-hidden rounded-card border border-ink-800">
              {activity.map((a) => {
                const body = (
                  <div className="flex items-center justify-between gap-3 bg-ink-900 px-4 py-3">
                    <span className="truncate text-sm text-chalk">{a.title}</span>
                    <span className="shrink-0 text-xs text-fog">{timeAgo(a.createdAt)}</span>
                  </div>
                );
                return a.url ? (
                  <li key={a.id}><Link href={a.url} className="block transition-colors hover:bg-ink-850">{body}</Link></li>
                ) : (
                  <li key={a.id}>{body}</li>
                );
              })}
            </ul>
          )}
        </Section>

        {/* Momentum footer — a public profile used to end cold. It's a high-
            traffic destination (every leaderboard row lands here), so it closes
            on the competition loop: out-predict them, or share the card. */}
        <div className="mt-8 mb-4 flex flex-col items-center gap-3 card-surface p-6 text-center sm:flex-row sm:justify-between sm:text-left">
          <div>
            <p className="font-display text-sm font-bold text-chalk">Think you can out-predict {displayName.split(" ")[0]}?</p>
            <p className="mt-0.5 text-2xs text-fog">Call the next card and climb the same board.</p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <ButtonLink href="/events" size="sm">Predict a fight</ButtonLink>
            <ShareMenu path={`/u/${u.username}`} title={`${displayName} on GlobalFight`} />
          </div>
        </div>
      </div>
    </div>
  );
}

function Tile({ icon, label, value, sub }: { icon: React.ReactNode; label: string; value: string; sub: string }) {
  return (
    <div className="card-surface p-4">
      <p className="flex items-center gap-1.5 text-3xs uppercase tracking-wider text-fog">{icon}{label}</p>
      <p className="mt-1 font-display text-2xl font-black tabular-nums text-chalk">{value}</p>
      <p className="text-2xs text-fog">{sub}</p>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mt-8">
      <h2 className="mb-3 font-display text-sm font-bold uppercase tracking-[0.18em] text-fog">{title}</h2>
      {children}
    </section>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <p className="rounded-card border border-dashed border-ink-800 bg-ink-900/40 p-6 text-center text-sm text-fog">{children}</p>;
}

export const dynamic = "force-dynamic";
