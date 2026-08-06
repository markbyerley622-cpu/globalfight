import "server-only";
import { prisma } from "@/lib/db";
import { isAdminRole } from "@/lib/admin/roles";
import { gymVerificationState, gymCapabilities } from "@/lib/gyms/verification";
import { ANONYMOUS, type Viewer } from "./visibility";
import type { GymRefDTO } from "./types";

// ════════════════════════════════════════════════════════════════════════════
//  Resolving WHO the viewer is, relative to a gym.
//
//  The decisions themselves live in visibility.ts and are pure. This file only
//  answers the three factual questions those decisions need — are you staff,
//  are you a member, do you own this gym — and it answers them from the
//  DATABASE, never from the request body.
//
//  ── Why it re-derives the verification state instead of calling
//     authoriseGymCapability ───────────────────────────────────────────────
//  That helper is the right tool for an OWNER-ONLY dashboard action: it refuses
//  anyone who is not the owner or staff, and it answers with a NextResponse.
//  A gym feed has to serve members and the public too, so it needs the same
//  facts without the refusal and without the HTTP shape.
//
//  What it must NOT do is re-derive the RULE. gymVerificationState and
//  gymCapabilities are imported and called — the same pure functions
//  authoriseGymCapability calls — so publishing rights cannot come to two
//  different answers depending on which door you came through. Duplicating the
//  derivation is precisely how the badge and the gate drift apart.
// ════════════════════════════════════════════════════════════════════════════

export interface GymContext {
  gym: GymRefDTO & { id: string };
  viewer: Viewer;
  /** Does the gym's verification state permit publishing to its feed at all? */
  gymMayPublish: boolean;
}

/** The signed-in principal, as this module needs it. */
export interface Principal {
  id: string;
  role: string;
}

/**
 * Load a gym and the viewer's relationship to it in ONE round trip.
 *
 * Membership is fetched as a filtered relation rather than a second query, so
 * this stays a single statement whether or not anyone is signed in. Returns
 * null when the gym does not exist — the caller decides between 404 and an
 * empty feed.
 */
export async function gymContext(
  slug: string,
  user: Principal | null,
): Promise<GymContext | null> {
  const gym = await prisma.gym.findUnique({
    where: { slug },
    select: {
      id: true, slug: true, name: true, logoUrl: true, verified: true, ownerId: true,
      // Only the statuses. A claim's evidence and notes have no business in a
      // feed request's hot path.
      claims: { select: { status: true } },
      members: user ? { where: { userId: user.id }, select: { id: true }, take: 1 } : false,
    },
  });
  if (!gym) return null;

  const state = gymVerificationState({
    ownerId: gym.ownerId,
    verified: gym.verified,
    claimStatuses: gym.claims.map((c) => c.status),
  });

  return {
    gym: { id: gym.id, slug: gym.slug, name: gym.name, logoUrl: gym.logoUrl, verified: gym.verified },
    viewer: viewerFor(user, gym.ownerId, (gym.members?.length ?? 0) > 0),
    gymMayPublish: gymCapabilities(state).publishPosts,
  };
}

/**
 * The viewer's relationship to a gym we have already loaded.
 *
 * Split out because the feed reads MANY gyms at once and must not run
 * gymContext per row — see membershipsFor below.
 */
export function viewerFor(
  user: Principal | null,
  gymOwnerId: string | null,
  isMember: boolean,
): Viewer {
  if (!user) return ANONYMOUS;
  return {
    id: user.id,
    // From User.role, via the ONE definition. Never registryRole, which is a
    // self-declared label with no privilege (CLAUDE.md).
    isStaff: isAdminRole(user.role),
    isMember,
    isGymOwner: gymOwnerId !== null && gymOwnerId === user.id,
  };
}

/**
 * Which of these gyms the viewer belongs to — ONE query for the whole page.
 *
 * The cross-gym feed has to answer "can this viewer see a MEMBERS post?" for
 * every row, and the naive version is a membership lookup per post. This is the
 * batched form: one IN query, a Set, and the visibility predicate then runs in
 * memory with no further reads however many gyms the page spans.
 */
export async function membershipsFor(
  userId: string | null,
  gymIds: string[],
): Promise<Set<string>> {
  if (!userId || gymIds.length === 0) return new Set();
  const rows = await prisma.gymMember.findMany({
    where: { userId, gymId: { in: [...new Set(gymIds)] } },
    select: { gymId: true },
  });
  return new Set(rows.map((r) => r.gymId));
}
