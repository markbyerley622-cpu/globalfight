import type { Metadata } from "next";
import Link from "next/link";
import Image from "next/image";
import { notFound } from "next/navigation";
import {
  MapPin, Globe, Phone, Instagram, Clock, BadgeCheck, Users, Flame, ShieldQuestion,
} from "lucide-react";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { getPresence } from "@/lib/geo/presence";
import { CheckInButton } from "@/components/map/check-in-button";
import { GymMembershipButtons } from "@/components/map/gym-membership";
import { cn } from "@/lib/utils";

export const dynamic = "force-dynamic";

async function loadGym(slug: string) {
  return prisma.gym.findUnique({
    where: { slug },
    select: {
      id: true, slug: true, name: true, description: true,
      logoUrl: true, heroUrl: true, address: true, city: true, region: true, country: true,
      website: true, instagram: true, phone: true, hoursNote: true,
      disciplines: true, verified: true, memberCount: true, ownerId: true,
      members: {
        orderBy: [{ role: "asc" }, { createdAt: "asc" }],
        take: 24,
        select: {
          role: true, isHome: true,
          user: { select: { id: true, name: true, username: true, image: true, registryRole: true } },
        },
      },
    },
  });
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const gym = await prisma.gym.findUnique({
    where: { slug },
    select: { name: true, city: true, country: true, description: true, disciplines: true },
  });
  if (!gym) return { title: "Gym" };
  const where = [gym.city, gym.country].filter(Boolean).join(", ");
  return {
    title: `${gym.name}${where ? ` — ${where}` : ""}`,
    description:
      gym.description ??
      `${gym.name}${where ? ` in ${where}` : ""}${gym.disciplines.length ? ` — ${gym.disciplines.join(", ")}` : ""}. Members, classes and who's training now.`,
    alternates: { canonical: `/gyms/${slug}` },
  };
}

export default async function GymPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const gym = await loadGym(slug);
  if (!gym) notFound();

  const user = await getCurrentUser().catch(() => null);
  const presence = await getPresence({ gymId: gym.id }, user?.id);
  const mine = user ? gym.members.find((m) => m.user.id === user.id) : undefined;

  const place = [gym.address, gym.city, gym.region, gym.country].filter(Boolean).join(", ");
  const coaches = gym.members.filter((m) => m.role === "coach" || m.role === "owner");

  return (
    <div className="mx-auto w-full max-w-2xl pb-16 lg:max-w-3xl">
      {/* Hero */}
      <div className="relative h-36 overflow-hidden border-b border-ink-800 sm:h-44">
        {gym.heroUrl ? (
          <Image src={gym.heroUrl} alt="" fill className="object-cover" unoptimized priority />
        ) : (
          <div className="absolute inset-0 bg-[radial-gradient(500px_240px_at_20%_0%,rgba(56,189,248,0.28),transparent_62%),linear-gradient(140deg,#141923,#0a0d12)]" />
        )}
        <div className="absolute inset-0 vignette" />
      </div>

      <div className="px-4">
        <div className="-mt-9 flex items-end gap-3">
          <span className="grid size-[74px] shrink-0 place-items-center overflow-hidden rounded-2xl border-[3px] border-volt-500/60 bg-ink-950">
            {gym.logoUrl ? (
              <Image src={gym.logoUrl} alt="" width={74} height={74} className="size-full object-cover" unoptimized />
            ) : (
              <span className="font-display text-2xl font-black text-volt-400">
                {gym.name.slice(0, 2).toUpperCase()}
              </span>
            )}
          </span>
          {presence.count > 0 && (
            <span className="mb-1 inline-flex items-center gap-1.5 rounded-lg bg-blood-500/15 px-2.5 py-1.5 font-display text-[0.7rem] font-bold uppercase tracking-wide text-blood-300">
              <Flame className="size-3.5" /> {presence.count} here now
              {presence.coaches > 0 && <span className="text-blood-300/70">· {presence.coaches} coaching</span>}
            </span>
          )}
        </div>

        <h1 className="mt-3 flex items-center gap-2 font-display text-2xl font-black tracking-tight text-chalk">
          {gym.name}
          {gym.verified && <BadgeCheck className="size-5 shrink-0 text-volt-400" />}
        </h1>

        {gym.disciplines.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1.5">
            {gym.disciplines.map((d) => (
              <span key={d} className="rounded-md border border-volt-500/25 bg-volt-500/10 px-2 py-0.5 text-[0.68rem] font-semibold uppercase tracking-wide text-volt-400">
                {d}
              </span>
            ))}
          </div>
        )}

        {gym.description && <p className="mt-3 text-sm leading-relaxed text-mist">{gym.description}</p>}

        {/* Actions */}
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <CheckInButton
            gymId={gym.id}
            initialHere={presence.count}
            initialChecked={presence.viewerCheckedIn}
            signedIn={!!user}
          />
          <GymMembershipButtons
            slug={gym.slug}
            initialMember={!!mine}
            initialIsHome={!!mine?.isHome}
            initialCount={gym.memberCount}
            signedIn={!!user}
          />
        </div>

        {/* Facts */}
        <dl className="mt-5 grid grid-cols-[auto_1fr] gap-x-3 gap-y-2.5 rounded-2xl border border-ink-800 bg-ink-900 p-4 text-sm">
          {place && (
            <>
              <dt className="pt-0.5 text-fog"><MapPin className="size-4" /></dt>
              <dd className="text-mist">{place}</dd>
            </>
          )}
          <dt className="pt-0.5 text-fog"><Users className="size-4" /></dt>
          <dd className="text-mist">{gym.memberCount} member{gym.memberCount === 1 ? "" : "s"} on Combat Reviews</dd>
          {gym.hoursNote && (
            <>
              <dt className="pt-0.5 text-fog"><Clock className="size-4" /></dt>
              <dd className="text-mist">{gym.hoursNote}</dd>
            </>
          )}
          {gym.website && (
            <>
              <dt className="pt-0.5 text-fog"><Globe className="size-4" /></dt>
              <dd>
                <a href={gym.website} target="_blank" rel="noopener noreferrer nofollow" className="text-volt-400 underline-offset-2 hover:underline">
                  {gym.website.replace(/^https?:\/\//, "")}
                </a>
              </dd>
            </>
          )}
          {gym.instagram && (
            <>
              <dt className="pt-0.5 text-fog"><Instagram className="size-4" /></dt>
              <dd className="text-mist">{gym.instagram}</dd>
            </>
          )}
          {gym.phone && (
            <>
              <dt className="pt-0.5 text-fog"><Phone className="size-4" /></dt>
              <dd className="text-mist">{gym.phone}</dd>
            </>
          )}
        </dl>

        {/* Who's here now */}
        {presence.sample.length > 0 && (
          <Section title={`Training now · ${presence.count}`}>
            <div className="flex flex-wrap gap-2">
              {presence.sample.map((p) => (
                <PersonChip
                  key={p.id}
                  name={p.name ?? p.username ?? "Someone"}
                  username={p.username}
                  image={p.image}
                  note={p.role === "coach" ? "Coach" : p.note}
                  live
                />
              ))}
              {presence.count > presence.sample.length && (
                <span className="grid h-9 place-items-center rounded-full border border-ink-700 bg-ink-850 px-3 text-[0.72rem] font-semibold text-fog">
                  +{presence.count - presence.sample.length} more
                </span>
              )}
            </div>
          </Section>
        )}

        {coaches.length > 0 && (
          <Section title="Coaches">
            <div className="flex flex-wrap gap-2">
              {coaches.map((m) => (
                <PersonChip
                  key={m.user.id}
                  name={m.user.name ?? m.user.username ?? "Coach"}
                  username={m.user.username}
                  image={m.user.image}
                  note={m.role === "owner" ? "Head coach" : "Coach"}
                />
              ))}
            </div>
          </Section>
        )}

        <Section title={`Members · ${gym.memberCount}`}>
          {gym.members.length === 0 ? (
            <p className="rounded-xl border border-dashed border-ink-700 px-4 py-6 text-center text-sm text-fog">
              Nobody has joined yet. Be the first — it puts this gym on your profile and on the map.
            </p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {gym.members.map((m) => (
                <PersonChip
                  key={m.user.id}
                  name={m.user.name ?? m.user.username ?? "Member"}
                  username={m.user.username}
                  image={m.user.image}
                  note={m.isHome ? "Home gym" : null}
                />
              ))}
            </div>
          )}
        </Section>

        {/* Claim */}
        {!gym.ownerId && (
          <Link
            href={`/gyms/${gym.slug}/claim`}
            className="mt-6 flex items-center gap-3 rounded-2xl border border-ink-800 bg-ink-900 px-4 py-3.5 transition-colors hover:border-gold-500/40"
          >
            <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-gold-500/12 text-gold-300">
              <ShieldQuestion className="size-4" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block font-display text-sm font-bold text-chalk">Is this your gym?</span>
              <span className="block text-[0.72rem] leading-relaxed text-fog">
                Claim the page to manage details, photos and classes.
              </span>
            </span>
          </Link>
        )}
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mt-6">
      <h2 className="mb-2.5 font-display text-sm font-bold uppercase tracking-wide text-chalk">{title}</h2>
      {children}
    </section>
  );
}

function PersonChip({
  name, username, image, note, live,
}: { name: string; username: string | null; image: string | null; note?: string | null; live?: boolean }) {
  const inner = (
    <>
      {image ? (
        <Image src={image} alt="" width={28} height={28} unoptimized className="size-7 rounded-full object-cover" />
      ) : (
        <span className="grid size-7 place-items-center rounded-full bg-blood-500/15 text-[0.7rem] font-bold text-blood-300">
          {name.slice(0, 1).toUpperCase()}
        </span>
      )}
      <span className="min-w-0">
        <span className="block max-w-[9rem] truncate text-[0.76rem] font-semibold text-chalk">{name}</span>
        {note && <span className="block text-[0.62rem] uppercase tracking-wide text-fog">{note}</span>}
      </span>
      {live && <span className="live-dot shrink-0" />}
    </>
  );
  const cls = cn(
    "flex items-center gap-2 rounded-full border px-2.5 py-1.5 transition-colors",
    live ? "border-blood-500/30 bg-blood-500/8" : "border-ink-700 bg-ink-900",
    username && "hover:border-ink-600",
  );
  return username ? <Link href={`/u/${username}`} className={cls}>{inner}</Link> : <span className={cls}>{inner}</span>;
}
