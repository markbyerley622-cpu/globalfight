import "server-only";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { isAdminRole } from "@/lib/admin/guard";
import {
  gymVerificationState, gymCapabilities,
  type GymVerificationState, type GymCapabilities,
} from "./verification";

// ════════════════════════════════════════════════════════════════════════════
//  "May this request do THIS to this gym?" — identity AND state, together.
//
//  ── What this adds over authoriseGymEdit ─────────────────────────────────
//  geo/gym-auth answers "is this the owner?", which is the identity half and is
//  correct as far as it goes. It has no idea whether the gym was ever REVIEWED,
//  so `ownerId` alone was the gate on publishing — and ownerId can be set
//  outside the claim flow (an import, an admin repairing data). A row in that
//  position could publish without a human ever having looked at a claim.
//
//  This asks both questions:
//     WHO are you   → owner, or staff
//     WHAT state is the gym in → does that state permit this capability
//
//  Both must pass. Staff bypass the CAPABILITY check (moderation and support
//  have to work on an unverified page) but are still logged by the caller's own
//  audit path — they never bypass identity, because there is nothing to bypass:
//  they are authenticated as themselves.
//
//  ── Why capability rather than a boolean ─────────────────────────────────
//  "Can edit" and "can publish to a feed" are not the same right, and folding
//  them together is how a future read-only-but-claimed state becomes impossible
//  to express. The caller names the capability it needs.
// ════════════════════════════════════════════════════════════════════════════

export interface GymGrant {
  gym: {
    id: string; slug: string; name: string;
    ownerId: string | null; verified: boolean;
    logoUrl: string | null; heroUrl: string | null;
  };
  userId: string;
  state: GymVerificationState;
  capabilities: GymCapabilities;
  /** True when this passed on staff privileges rather than ownership. */
  viaStaff: boolean;
}

type Refusal = { ok: false; response: NextResponse };
type Result = { ok: true; value: GymGrant } | Refusal;

const refuse = (error: string, status: number): Refusal => ({
  ok: false,
  response: NextResponse.json({ error }, { status }),
});

/**
 * Authorise a capability on a gym.
 *
 * Order of checks is deliberate and is the usual source of leaks if it drifts:
 *   1. authenticated?     → 401
 *   2. gym exists?        → 404
 *   3. owner or staff?    → 403 (identity, from the DATABASE — never the body)
 *   4. state permits it?  → 403 with a message that says what to do next
 */
export async function authoriseGymCapability(
  slug: string,
  capability: keyof GymCapabilities,
): Promise<Result> {
  const user = await getCurrentUser();
  if (!user) return refuse("Sign in.", 401);

  const gym = await prisma.gym.findUnique({
    where: { slug },
    select: {
      id: true, slug: true, name: true, ownerId: true, verified: true,
      logoUrl: true, heroUrl: true,
      // Only the statuses — the claim's evidence and notes are none of this
      // function's business and must not be pulled into a hot path.
      claims: { select: { status: true } },
    },
  });
  if (!gym) return refuse("No such gym.", 404);

  const staff = isAdminRole(user.role);
  const owns = gym.ownerId === user.id;
  if (!owns && !staff) return refuse("You don't manage this gym.", 403);

  const state = gymVerificationState({
    ownerId: gym.ownerId,
    verified: gym.verified,
    claimStatuses: gym.claims.map((c) => c.status),
  });
  const capabilities = gymCapabilities(state);

  // Staff are exempt from the state gate — moderation and support have to be
  // able to act on an unverified page — but never from being authenticated.
  if (!staff && !capabilities[capability]) {
    return refuse(
      state === "CLAIM_PENDING"
        ? "Your claim on this gym is still being reviewed. You'll be able to manage the page once it's approved."
        : "This gym isn't verified yet. Claim it and we'll review your evidence.",
      403,
    );
  }

  const { claims: _claims, ...rest } = gym;
  return { ok: true, value: { gym: rest, userId: user.id, state, capabilities, viaStaff: !owns && staff } };
}

/**
 * The same derivation for a READ.
 *
 * Public surfaces need the state to render the badge and the claim prompt, and
 * they must get it from here rather than testing `verified` themselves — a
 * badge derived from a different rule than the one gating publishing is how the
 * two drift apart.
 */
export async function getGymVerification(gymId: string): Promise<GymVerificationState> {
  const gym = await prisma.gym.findUnique({
    where: { id: gymId },
    select: { ownerId: true, verified: true, claims: { select: { status: true } } },
  });
  if (!gym) return "UNCLAIMED";
  return gymVerificationState({
    ownerId: gym.ownerId,
    verified: gym.verified,
    claimStatuses: gym.claims.map((c) => c.status),
  });
}
