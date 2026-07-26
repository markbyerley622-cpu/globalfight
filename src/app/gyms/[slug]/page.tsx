import type { Metadata } from "next";
import Link from "next/link";
import Image from "next/image";
import { notFound } from "next/navigation";
import {
  MapPin, Globe, Phone, Instagram, Clock, BadgeCheck, Users, Flame, ShieldQuestion, Settings, Facebook, Youtube,
} from "lucide-react";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { getPresence } from "@/lib/geo/presence";
import { CheckInButton } from "@/components/map/check-in-button";
import { GymMembershipButtons } from "@/components/map/gym-membership";
import { GymPublicGallery } from "@/components/map/gym-public-gallery";
import { GymReviews } from "@/components/gyms/gym-reviews";
import { getGymReviewData } from "@/lib/gym-reviews";
import { isFollowing, followerCount } from "@/lib/follow-targets";
import { FollowButton } from "@/components/follow-button";

export const dynamic = "force-dynamic";

async function loadGym(slug: string) {
  return prisma.gym.findUnique({
    where: { slug },
    select: {
      id: true, slug: true, name: true, description: true,
      logoUrl: true, heroUrl: true, address: true, city: true, region: true, country: true,
      website: true, instagram: true, facebook: true, youtube: true, tiktok: true,
      phone: true, hoursNote: true,
      disciplines: true, verified: true, memberCount: true, ownerId: true, countryCode: true,
      photos: {
        orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
        select: { id: true, url: true, thumbUrl: true, width: true, height: true, caption: true, alt: true, credit: true },
      },
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
  // Wave 1: the gym and the viewer are independent — fetch together.
  const [gym, user] = await Promise.all([loadGym(slug), getCurrentUser().catch(() => null)]);
  if (!gym) notFound();

  // Wave 2: presence, reviews and "nearby" all depend only on the gym/viewer we
  // now have and NOT on each other — one parallel batch instead of three
  // sequential round-trips on a public, high-traffic page.
  const [presence, reviewData, nearby, gymFollowers, gymFollowing] = await Promise.all([
    getPresence({ gymId: gym.id }, user?.id),
    getGymReviewData(gym.id, user?.id),
    // Nearby = same city first, then same country. Cheap, indexed, and honest:
    // we do not have street coordinates for most gyms, so "nearby" means the
    // place people would actually consider as an alternative.
    gym.city || gym.countryCode
      ? prisma.gym.findMany({
          where: {
            id: { not: gym.id },
            OR: [
              ...(gym.city ? [{ city: { equals: gym.city, mode: "insensitive" as const } }] : []),
              ...(gym.countryCode ? [{ countryCode: gym.countryCode }] : []),
            ],
          },
          orderBy: [{ verified: "desc" }, { memberCount: "desc" }],
          take: 6,
          select: { slug: true, name: true, city: true, logoUrl: true, verified: true, memberCount: true, disciplines: true },
        })
      : Promise.resolve([]),
    // Follow state joins the SAME parallel wave — a follower count must never add a
    // sequential round-trip to a public, high-traffic page.
    followerCount({ type: "gym", id: gym.id }),
    user ? isFollowing(user.id, { type: "gym", id: gym.id }) : Promise.resolve(false),
  ]);
  const mine = user ? gym.members.find((m) => m.user.id === user.id) : undefined;

  const place = [gym.address, gym.city, gym.region, gym.country].filter(Boolean).join(", ");

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
        {/* The avatar overlaps the banner via -mt-9, and it used to disappear behind
            it. Not a z-index VALUE problem — a stacking one: the banner's children
            (<Image fill> and the vignette) are absolutely positioned, and positioned
            elements paint above static ones in the same stacking context regardless of
            DOM order. So the row must become a positioned element itself before any
            z-index applies to it. `relative z-10` is the whole fix. */}
        <div className="relative z-10 -mt-9 flex items-end gap-3">
          <span className="grid size-[74px] shrink-0 place-items-center overflow-hidden rounded-2xl border-[3px] border-volt-500/60 bg-ink-950 shadow-[0_8px_24px_-10px_rgba(0,0,0,0.9)]">
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

        <div className="mt-3 flex items-start justify-between gap-3">
          <h1 className="flex min-w-0 items-center gap-2 font-display text-2xl font-black tracking-tight text-chalk">
            <span className="truncate">{gym.name}</span>
            {gym.verified && <BadgeCheck className="size-5 shrink-0 text-volt-400" />}
          </h1>
          {/* The SAME FollowButton every other entity uses — one component, one
              endpoint contract, so a gym behaves exactly like a fighter or an event.
              This is what the polymorphic follow model was for: nothing here is
              gym-specific except the word "gym". */}
          <FollowButton
            kind="gym"
            slug={gym.slug}
            name={gym.name}
            initialFollowing={gymFollowing}
            size="sm"
          />
        </div>

        {gymFollowers > 0 && (
          <p className="mt-1 text-xs text-fog">
            <span className="font-semibold text-mist">{gymFollowers.toLocaleString()}</span>{" "}
            {gymFollowers === 1 ? "follower" : "followers"}
          </p>
        )}

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
          {gym.facebook && (
            <>
              <dt className="pt-0.5 text-fog"><Facebook className="size-4" /></dt>
              <dd className="text-mist">{gym.facebook}</dd>
            </>
          )}
          {gym.youtube && (
            <>
              <dt className="pt-0.5 text-fog"><Youtube className="size-4" /></dt>
              <dd className="text-mist">{gym.youtube}</dd>
            </>
          )}
        </dl>

        {/* Gallery */}
        <Section title="Reviews">
          <GymReviews
            gymSlug={gym.slug}
            gymName={gym.name}
            disciplines={gym.disciplines}
            data={reviewData}
            signedIn={!!user}
          />
        </Section>

        {gym.photos.length > 0 && (
          <Section title="Photos">
            <GymPublicGallery photos={gym.photos} gymName={gym.name} />
          </Section>
        )}

        {nearby.length > 0 && (
          <Section title={`More gyms ${gym.city ? `in ${gym.city}` : "nearby"}`}>
            <ul className="flex flex-col gap-2">
              {nearby.map((n) => (
                <li key={n.slug}>
                  <Link
                    href={`/gyms/${n.slug}`}
                    className="flex items-center gap-3 rounded-xl border border-ink-700 bg-ink-900/60 p-3 transition-colors hover:border-volt-500/40"
                  >
                    <span className="grid size-9 shrink-0 place-items-center overflow-hidden rounded-xl border border-volt-500/25 bg-volt-500/10">
                      {n.logoUrl ? (
                        <Image src={n.logoUrl} alt="" width={36} height={36} unoptimized className="size-full object-cover" />
                      ) : (
                        <span className="font-display text-[0.7rem] font-black text-volt-400">
                          {n.name.slice(0, 2).toUpperCase()}
                        </span>
                      )}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-1.5">
                        <span className="truncate font-display text-sm font-bold text-chalk">{n.name}</span>
                        {n.verified && <BadgeCheck className="size-3.5 shrink-0 text-volt-400" />}
                      </span>
                      <span className="block truncate text-[0.7rem] text-fog">
                        {[n.city, n.disciplines.slice(0, 2).join(", ")].filter(Boolean).join(" · ")}
                      </span>
                    </span>
                    <span className="shrink-0 text-[0.68rem] tabular-nums text-fog">{n.memberCount}</span>
                  </Link>
                </li>
              ))}
            </ul>
          </Section>
        )}

        {/* Owner shortcut — replaces the claim prompt entirely for the owner. */}
        {gym.ownerId && user && gym.ownerId === user.id && (
          <Link
            href={`/gyms/${gym.slug}/manage`}
            className="mt-6 flex items-center gap-3 rounded-2xl border border-up/30 bg-up/8 px-4 py-3.5 transition-colors hover:border-up/50"
          >
            <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-up/15 text-up">
              <Settings className="size-4" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block font-display text-sm font-bold text-chalk">You manage this gym</span>
              <span className="block text-[0.72rem] leading-relaxed text-fog">
                Edit details, disciplines, hours and contact info.
              </span>
            </span>
          </Link>
        )}

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

