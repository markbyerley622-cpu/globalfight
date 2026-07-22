import type { Metadata } from "next";
import { notFound } from "next/navigation";
import Image from "next/image";
import Link from "next/link";
import { Trophy, Target, Flame, Layers, Crown, TrendingUp } from "lucide-react";
import { prisma } from "@/lib/db";
import { getTrainingNowFor } from "@/lib/geo/presence";
import { getProfileStats } from "@/lib/profile-stats";
import { getUserCards } from "@/lib/collectibles";
import { getUserActivity } from "@/lib/activity";
import { Badge } from "@/components/ui/badge";
import { timeAgo } from "@/lib/utils";
import type { CardRarity } from "@prisma/client";

const RARITY_TINT: Record<CardRarity, string> = {
  LEGEND: "text-gold-300", CHAMPION: "text-gold-400", EPIC: "text-volt-400", RARE: "text-blood-300", BASE: "text-fog",
};

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
  const who = u.name ?? `@${u.username}`;
  const desc = stats && stats.picksResolved
    ? `${who} — ${stats.reputation.toLocaleString()} reputation · ${stats.accuracy}% accuracy · best ${stats.bestPickStreak}-fight streak on Combat Reviews.`
    : `${who} on Combat Reviews.`;
  return { title: `${who} — Combat Reviews`, description: desc, alternates: { canonical: `/u/${u.username}` } };
}

export default async function PublicProfile({ params }: { params: Promise<{ username: string }> }) {
  const { username } = await params;
  const u = await loadUser(username);
  if (!u?.username) notFound();

  const [stats, cards, activity, rankedTotal, trainingNow] = await Promise.all([
    getProfileStats(u.id),
    getUserCards(u.id),
    getUserActivity(u.id, 8),
    prisma.user.count({ where: { picksResolved: { gt: 0 } } }),
    // Live gym check-in. Derived from CheckIn rather than a stored status
    // field, so it cannot disagree with the check-in that produced it and it
    // expires on its own.
    getTrainingNowFor(u.id),
  ]);

  const displayName = u.name ?? `@${u.username}`;
  const rep = stats?.reputation ?? 0;
  const acc = stats?.accuracy ?? 0;
  const streak = stats?.pickStreak ?? 0;
  const bestStreak = stats?.bestPickStreak ?? 0;
  const resolved = stats?.picksResolved ?? 0;
  const cardsTotal = stats?.cardsTotal ?? 0;
  const elite = (stats?.cardsByRarity.CHAMPION ?? 0) + (stats?.cardsByRarity.LEGEND ?? 0);
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
  if (elite >= 3) chips.push({ icon: <Crown className="size-3" />, label: "Champion collector", tone: "gold" });
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
          <div className="shrink-0 rounded-2xl border border-ink-800 bg-ink-900 px-5 py-3 text-center">
            <p className="inline-flex items-center gap-1.5 font-display text-2xl font-black tabular-nums text-chalk">
              <Trophy className="size-5 text-gold-400" /> {rep.toLocaleString()}
            </p>
            <p className="text-[0.65rem] uppercase tracking-wider text-fog">Reputation</p>
          </div>
        </div>

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
          <Tile icon={<Layers className="size-4 text-gold-400" />} label="Cards" value={cardsTotal ? String(cardsTotal) : "—"} sub={elite ? `${elite} elite` : "collected"} />
          <Tile icon={<Trophy className="size-4 text-gold-400" />} label="Rank" value={rank ? `#${rank}` : "—"} sub={percentile ? `top ${percentile}%` : "unranked"} />
        </div>

        {/* Collection */}
        <Section title="Collection">
          {cards.length === 0 ? (
            <Empty>No cards yet — {displayName.split(" ")[0]} earns one for every fight they call correctly.</Empty>
          ) : (
            <div className="flex gap-3 overflow-x-auto pb-2">
              {cards.slice(0, 14).map((c) => (
                <Link key={c.id} href={`/fighters/${c.fighter.slug}`} className="w-24 shrink-0 rounded-xl border border-ink-800 bg-ink-900 p-2 text-center transition-colors hover:border-ink-700">
                  <div className="mx-auto mb-1.5 size-16 overflow-hidden rounded-lg bg-ink-800">
                    {(c.fighter.thumbUrl || c.fighter.imageUrl) && (
                      <Image src={(c.fighter.thumbUrl || c.fighter.imageUrl)!} alt={c.fighter.name} width={64} height={64} className="size-full object-cover" unoptimized />
                    )}
                  </div>
                  <p className="truncate text-[0.7rem] font-semibold text-chalk">{c.fighter.name}</p>
                  <p className={`text-[0.6rem] font-bold uppercase tracking-wide ${RARITY_TINT[c.rarity]}`}>{c.rarity}</p>
                </Link>
              ))}
            </div>
          )}
        </Section>

        {/* Recent activity */}
        <Section title="Recent form">
          {activity.length === 0 ? (
            <Empty>Nothing to show yet — their picks and cards will appear here.</Empty>
          ) : (
            <ul className="divide-y divide-ink-800 overflow-hidden rounded-2xl border border-ink-800">
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
      </div>
    </div>
  );
}

function Tile({ icon, label, value, sub }: { icon: React.ReactNode; label: string; value: string; sub: string }) {
  return (
    <div className="rounded-2xl border border-ink-800 bg-ink-900 p-4">
      <p className="flex items-center gap-1.5 text-[0.65rem] uppercase tracking-wider text-fog">{icon}{label}</p>
      <p className="mt-1 font-display text-2xl font-black tabular-nums text-chalk">{value}</p>
      <p className="text-[0.7rem] text-fog">{sub}</p>
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
  return <p className="rounded-2xl border border-dashed border-ink-800 bg-ink-900/40 p-6 text-center text-sm text-fog">{children}</p>;
}

export const dynamic = "force-dynamic";
