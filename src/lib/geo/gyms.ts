import "server-only";
import { prisma } from "@/lib/db";
import { resolvePoint } from "./gazetteer";
import { getPresenceCounts } from "./presence";
import type { MapPin, UnmappedPin } from "./types";

// ════════════════════════════════════════════════════════════════════════════
//  Gyms and fight clubs as map entities.
//
//  A gym carries REAL coordinates (Gym.latitude/longitude) because a gym is an
//  address — "somewhere in Bangkok" does not get you to a 6am class. When those
//  are null we fall back to the city gazetteer and label the pin approximate;
//  when even that fails the gym is listed off-map rather than mis-pinned.
//
//  Fight clubs are communities with coordinates (ForumCategory.kind ===
//  "fight_club"), so they inherit threads, membership and moderation from the
//  community system instead of duplicating it.
// ════════════════════════════════════════════════════════════════════════════

const MAX = 300;

export interface PlacesResult {
  pins: MapPin[];
  unmapped: UnmappedPin[];
}

/** Gyms, with live presence counts and the viewer's own membership folded in. */
export async function gymPins(viewerId: string | null): Promise<PlacesResult> {
  const rows = await prisma.gym.findMany({
    take: MAX,
    orderBy: [{ verified: "desc" }, { memberCount: "desc" }],
    select: {
      id: true, slug: true, name: true, description: true,
      logoUrl: true, heroUrl: true, website: true,
      address: true, city: true, country: true, countryCode: true,
      latitude: true, longitude: true,
      disciplines: true, verified: true, memberCount: true,
      members: viewerId
        ? { where: { userId: viewerId }, take: 1, select: { isHome: true } }
        : false,
    },
  });

  const present = await getPresenceCounts("gym", rows.map((g) => g.id));

  const pins: MapPin[] = [];
  const unmapped: UnmappedPin[] = [];

  for (const g of rows) {
    const place = [g.address, g.city, g.country].filter(Boolean).join(" · ") || null;
    // Real coordinates first; gazetteer second; off-map third. Never invented.
    const exact = g.latitude !== null && g.longitude !== null;
    const point = exact
      ? { lat: g.latitude!, lon: g.longitude!, precision: "exact" as const }
      : resolvePoint(g);

    if (!point) {
      unmapped.push({
        id: g.id, layer: "gyms", name: g.name,
        subtitle: g.disciplines.join(" · ") || null,
        place, href: `/gyms/${g.slug}`,
      });
      continue;
    }

    const membership = Array.isArray(g.members) ? g.members[0] : undefined;

    pins.push({
      id: `g-${g.id}`,
      layer: "gyms",
      name: g.name,
      subtitle: g.disciplines.slice(0, 3).join(" · ") || "Training",
      address: place,
      lat: point.lat,
      lon: point.lon,
      precision: point.precision,
      imageUrl: g.heroUrl ?? g.logoUrl,
      href: `/gyms/${g.slug}`,
      website: g.website,
      searchQuery: [g.name, g.address, g.city, g.country].filter(Boolean).join(", "),
      badge: membership?.isHome ? "Your home gym" : membership ? "You train here" : g.verified ? "Verified" : null,
      presentNow: present.get(g.id) ?? 0,
      gym: {
        slug: g.slug,
        verified: g.verified,
        disciplines: g.disciplines,
        memberCount: g.memberCount,
        viewerIsMember: !!membership,
        isViewerHome: !!membership?.isHome,
      },
    });
  }

  return { pins, unmapped };
}

/** Fight clubs — located communities. */
export async function clubPins(viewerId: string | null): Promise<PlacesResult> {
  const rows = await prisma.forumCategory.findMany({
    where: { kind: "fight_club" },
    take: MAX,
    orderBy: { memberCount: "desc" },
    select: {
      id: true, slug: true, name: true, description: true,
      avatarUrl: true, bannerUrl: true, memberCount: true, meetsOn: true,
      city: true, country: true, countryCode: true, latitude: true, longitude: true,
      members: viewerId ? { where: { userId: viewerId }, take: 1, select: { id: true } } : false,
    },
  });

  const pins: MapPin[] = [];
  const unmapped: UnmappedPin[] = [];

  for (const c of rows) {
    const place = [c.city, c.country].filter(Boolean).join(" · ") || null;
    const exact = c.latitude !== null && c.longitude !== null;
    const point = exact
      ? { lat: c.latitude!, lon: c.longitude!, precision: "exact" as const }
      : resolvePoint(c);

    if (!point) {
      unmapped.push({
        id: c.id, layer: "clubs", name: c.name,
        subtitle: c.meetsOn, place, href: `/community/${c.slug}`,
      });
      continue;
    }

    const isMember = Array.isArray(c.members) && c.members.length > 0;

    pins.push({
      id: `c-${c.id}`,
      layer: "clubs",
      name: c.name,
      subtitle: c.meetsOn ?? `${c.memberCount} member${c.memberCount === 1 ? "" : "s"}`,
      address: place,
      lat: point.lat,
      lon: point.lon,
      precision: point.precision,
      imageUrl: c.bannerUrl ?? c.avatarUrl,
      href: `/community/${c.slug}`,
      searchQuery: [c.name, c.city, c.country].filter(Boolean).join(", "),
      badge: isMember ? "You're a member" : null,
      club: {
        slug: c.slug,
        memberCount: c.memberCount,
        meetsOn: c.meetsOn,
        viewerIsMember: isMember,
      },
    });
  }

  return { pins, unmapped };
}

// ── Membership ──────────────────────────────────────────────────────────────

/**
 * Join / leave a gym, and set the home gym.
 *
 * `isHome` is exclusive: setting a new home gym demotes the previous one in the
 * SAME transaction, because a fighter with two home gyms is a bug that shows up
 * on someone's profile, not an error anyone reports.
 */
export async function setGymMembership(opts: {
  userId: string;
  gymId: string;
  join: boolean;
  isHome?: boolean;
}): Promise<void> {
  const { userId, gymId, join, isHome } = opts;

  await prisma.$transaction(async (tx) => {
    if (!join) {
      const removed = await tx.gymMember.deleteMany({ where: { userId, gymId } });
      if (removed.count > 0) {
        await tx.gym.update({ where: { id: gymId }, data: { memberCount: { decrement: removed.count } } });
      }
      return;
    }

    const existing = await tx.gymMember.findUnique({
      where: { gymId_userId: { gymId, userId } },
      select: { id: true },
    });

    if (isHome) {
      await tx.gymMember.updateMany({ where: { userId, isHome: true }, data: { isHome: false } });
    }

    if (existing) {
      await tx.gymMember.update({ where: { id: existing.id }, data: { isHome: isHome ?? undefined } });
    } else {
      await tx.gymMember.create({ data: { userId, gymId, isHome: isHome ?? false } });
      await tx.gym.update({ where: { id: gymId }, data: { memberCount: { increment: 1 } } });
    }
  });
}

/** URL-safe unique slug for a newly created gym. */
export async function uniqueGymSlug(name: string): Promise<string> {
  const base =
    name.toLowerCase().normalize("NFD").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 48) ||
    "gym";
  for (let i = 0; i < 50; i++) {
    const slug = i === 0 ? base : `${base}-${i + 1}`;
    const taken = await prisma.gym.findUnique({ where: { slug }, select: { id: true } });
    if (!taken) return slug;
  }
  return `${base}-${Date.now().toString(36)}`;
}
