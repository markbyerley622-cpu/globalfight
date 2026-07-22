import "server-only";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { resolvePoint } from "./gazetteer";
import type { MapPin, UnmappedPin } from "./types";

// ════════════════════════════════════════════════════════════════════════════
//  The People layer — and its privacy gate.
//
//  This is the only file in the map stack that can leak a person, so the rule
//  is that it contains exactly ONE way to select people: `visibleTo()`. Nothing
//  else may build a user WHERE for the map. If a future surface needs people on
//  a map, it calls this, or it does not ship.
//
//  What is enforced here, in the DATABASE, not the UI:
//
//   · HIDDEN (the default for every account, including every account that
//     existed before this feature) never matches.
//   · PUBLIC matches anyone.
//   · FOLLOWERS matches only people the VIEWER follows AND who follow back —
//     mutual, because "friends" is not "anyone who followed me".
//   · GYM_MEMBERS matches only people who share a gym with the viewer.
//   · EVENTS_ONLY matches only while the person holds a live event check-in.
//   · A signed-out viewer sees PUBLIC only. There is no anonymous path to the
//     other four.
//
//  And regardless of setting: a user is only ever plotted at a CITY CENTRE
//  they chose (mapLat/mapLon, resolved from mapCity at save time). No device
//  position is stored anywhere in this schema, so none can be exposed.
// ════════════════════════════════════════════════════════════════════════════

export interface PeopleViewer {
  id: string;
  /** User ids the viewer follows. */
  following: Set<string>;
  /** User ids that follow the viewer. */
  followedBy: Set<string>;
  /** Gym ids the viewer belongs to. */
  gymIds: string[];
}

/** Load everything the gate needs about the viewer, in one round trip. */
export async function loadViewer(userId: string | null | undefined): Promise<PeopleViewer | null> {
  if (!userId) return null;
  const [following, followers, gyms] = await Promise.all([
    prisma.userFollow.findMany({ where: { followerId: userId }, select: { followingId: true } }),
    prisma.userFollow.findMany({ where: { followingId: userId }, select: { followerId: true } }),
    prisma.gymMember.findMany({ where: { userId }, select: { gymId: true } }),
  ]);
  return {
    id: userId,
    following: new Set(following.map((f) => f.followingId)),
    followedBy: new Set(followers.map((f) => f.followerId)),
    gymIds: gyms.map((g) => g.gymId),
  };
}

/**
 * THE gate. Returns a Prisma WHERE that can only ever match people this viewer
 * is permitted to see.
 *
 * Written as an OR of per-setting clauses rather than "fetch then filter in JS"
 * on purpose: a filter you can forget to apply is not a control, and a query
 * that over-fetches has already loaded the rows you meant to protect.
 */
export function visibleTo(viewer: PeopleViewer | null): Prisma.UserWhereInput {
  // Everyone on the map must have opted in AND have a resolved point.
  const base: Prisma.UserWhereInput = {
    mapLat: { not: null },
    mapLon: { not: null },
    underageFlagged: false,
  };

  const clauses: Prisma.UserWhereInput[] = [{ mapVisibility: "PUBLIC" }];

  if (viewer) {
    // Mutual follow only.
    const friends = [...viewer.following].filter((id) => viewer.followedBy.has(id));
    if (friends.length > 0) {
      clauses.push({ mapVisibility: "FOLLOWERS", id: { in: friends } });
    }
    if (viewer.gymIds.length > 0) {
      clauses.push({
        mapVisibility: "GYM_MEMBERS",
        gymMemberships: { some: { gymId: { in: viewer.gymIds } } },
      });
    }
    // Live event check-in only — the setting is "see me at events", and an
    // expired check-in is not an event.
    clauses.push({
      mapVisibility: "EVENTS_ONLY",
      checkIns: { some: { eventId: { not: null }, expiresAt: { gt: new Date() } } },
    });
    // Never hide the viewer from themselves — otherwise "am I on the map?"
    // is unanswerable from the map itself.
    clauses.push({ id: viewer.id, mapVisibility: { not: "HIDDEN" } });
  }

  return { ...base, OR: clauses };
}

const MAX_PEOPLE_PINS = 300;

export interface PeopleResult {
  pins: MapPin[];
  unmapped: UnmappedPin[];
}

/** The people layer. `viewer` decides who is even selectable — see visibleTo. */
export async function peoplePins(viewer: PeopleViewer | null): Promise<PeopleResult> {
  const rows = await prisma.user.findMany({
    where: visibleTo(viewer),
    take: MAX_PEOPLE_PINS,
    orderBy: { reputation: "desc" },
    select: {
      id: true, name: true, username: true, image: true,
      registryRole: true, sportPrefs: true,
      mapCity: true, mapCountryCode: true, mapLat: true, mapLon: true,
      openToSpar: true, lookingForTraining: true,
      gymMemberships: {
        where: { isHome: true },
        take: 1,
        select: { gym: { select: { name: true, slug: true } } },
      },
    },
  });

  const pins: MapPin[] = [];
  for (const u of rows) {
    if (u.mapLat === null || u.mapLon === null) continue; // belt and braces
    const homeGym = u.gymMemberships[0]?.gym ?? null;
    const sport = u.sportPrefs[0] ?? null;
    const role = u.registryRole && u.registryRole !== "fan" ? u.registryRole : null;

    pins.push({
      id: `u-${u.id}`,
      layer: "people",
      name: u.name ?? u.username ?? "Anonymous",
      subtitle: [role, sport].filter(Boolean).join(" · ") || "Fan",
      address: [homeGym?.name, u.mapCity].filter(Boolean).join(" · ") || u.mapCity,
      lat: u.mapLat,
      lon: u.mapLon,
      // A person's point is a city centre by construction; saying "city" here
      // is what makes the UI show "approx · city" rather than implying a street.
      precision: "city",
      imageUrl: u.image,
      href: u.username ? `/u/${u.username}` : null,
      searchQuery: u.mapCity ?? "",
      badge: u.openToSpar ? "Open to spar" : u.lookingForTraining ? "Looking to train" : null,
      person: {
        userId: u.id,
        username: u.username,
        role: role ?? "fan",
        homeGym: homeGym ? { name: homeGym.name, slug: homeGym.slug } : null,
        openToSpar: u.openToSpar,
        lookingForTraining: u.lookingForTraining,
      },
    });
  }

  return { pins, unmapped: [] };
}

// ── Follow graph ────────────────────────────────────────────────────────────

/** Follow / unfollow. Idempotent in both directions. */
export async function setFollow(followerId: string, followingId: string, on: boolean): Promise<void> {
  if (followerId === followingId) return; // following yourself is not a feature
  if (on) {
    await prisma.userFollow.upsert({
      where: { followerId_followingId: { followerId, followingId } },
      create: { followerId, followingId },
      update: {},
    });
  } else {
    await prisma.userFollow.deleteMany({ where: { followerId, followingId } });
  }
}

export async function getFollowCounts(userId: string) {
  const [followers, following] = await Promise.all([
    prisma.userFollow.count({ where: { followingId: userId } }),
    prisma.userFollow.count({ where: { followerId: userId } }),
  ]);
  return { followers, following };
}

/** Resolve a user's chosen city into the point the map will plot. Called on
 *  every write of mapCity so the layer never geocodes at read time. */
export function resolveUserPoint(city: string | null, countryCode: string | null) {
  if (!city) return { mapLat: null, mapLon: null };
  const p = resolvePoint({ city, countryCode });
  return p ? { mapLat: p.lat, mapLon: p.lon } : { mapLat: null, mapLon: null };
}
