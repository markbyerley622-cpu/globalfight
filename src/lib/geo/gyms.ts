import "server-only";
import { randomUUID } from "node:crypto";
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
    if (join) {
      // Home gym is exclusive: demote the previous one first, in the same
      // transaction, so a fighter can never end up with two.
      if (isHome) {
        await tx.gymMember.updateMany({ where: { userId, isHome: true }, data: { isHome: false } });
      }

      // A TRUE atomic upsert. Three approaches were measured against a live
      // Postgres with 8 concurrent joins:
      //
      //   find-then-create  → 4/8 failed (check-then-act race)
      //   prisma.upsert     → 3/8 failed (Prisma still reads, then inserts)
      //   catch P2002       → 7/8 failed, and this is the instructive one:
      //                       Postgres raises 25P02 "current transaction is
      //                       aborted" after ANY error, so a catch INSIDE a
      //                       transaction cannot recover — the tx is poisoned.
      //
      // ON CONFLICT never raises, so the transaction is never poisoned and the
      // write is genuinely idempotent. `role` is intentionally absent from the
      // DO UPDATE: a coach or owner re-joining must not be demoted to member.
      await tx.$executeRaw`
        INSERT INTO "GymMember" ("id", "gymId", "userId", "role", "isHome", "createdAt")
        VALUES (${randomUUID()}, ${gymId}, ${userId}, 'member', ${isHome ?? false}, NOW())
        ON CONFLICT ("gymId", "userId") DO UPDATE
          SET "isHome" = COALESCE(${isHome ?? null}::boolean, "GymMember"."isHome")
      `;
    } else {
      await tx.gymMember.deleteMany({ where: { userId, gymId } });
    }

    // memberCount is RECOMPUTED rather than incremented. An increment has to
    // know whether the upsert inserted or updated — which Prisma does not tell
    // you — and any past drift would persist forever. One COUNT per join/leave
    // is trivial and makes the denormalised value self-healing.
    const memberCount = await tx.gymMember.count({ where: { gymId } });
    await tx.gym.update({ where: { id: gymId }, data: { memberCount } });
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
