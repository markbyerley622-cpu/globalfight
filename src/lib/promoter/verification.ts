// ════════════════════════════════════════════════════════════════════════════
//  PROMOTER VERIFICATION — who may put an event in front of the public.
//
//  ── Why this exists, and why it is not `registryRole` ─────────────────────
//  `registryRole` already has a "promoter" member and it grants NOTHING. That
//  is deliberate and CLAUDE.md states it twice: it is a SELF-DECLARED label
//  chosen at signup with no evidence behind it, it drives UI nudges only, and
//  no authorization decision may ever read it. Anyone can pick it.
//
//  Hosting an event is the strongest publishing right in the product. A
//  promoter event writes to the SAME Event/Fight rows the ingest pipeline
//  fills, appears in the public events grid, accepts predictions, and settles
//  them at fight night — a bogus card with a real-looking result corrupts every
//  leaderboard that touched it. So the right has to be earned the way gym
//  ownership is: a claim, evidence, a human decision.
//
//  ── Deliberately the same shape as lib/gyms/verification ──────────────────
//  That module's header says, in writing, that it was built to generalise:
//  "Promoters, federations and commissions will need exactly this: unclaimed
//  listing → claim under review → verified organisation with a dashboard."
//  This is that reuse. Same states, same NONE-until-reviewed precedence, same
//  pure derivation — so a reader who knows one knows the other, and the two
//  cannot drift into different answers to the same question.
//
//  PURE. No prisma, no env, no server-only — so it is unit-testable and cannot
//  disagree with itself between the dashboard, the API and the public page.
// ════════════════════════════════════════════════════════════════════════════

/** Where a promoter organisation sits on the path to hosting events. */
export type PromoterState =
  /** Not a promoter. The default for every account in the product. */
  | "NONE"
  /** Applied to host events; staff have not decided yet. Grants nothing. */
  | "CLAIM_PENDING"
  /** An application was refused. Grants nothing; may re-apply. */
  | "CLAIM_REJECTED"
  /** Reviewed and approved. The hosting dashboard is open. */
  | "VERIFIED"
  /**
   * Was verified, and the right has been withdrawn.
   *
   * Distinct from REJECTED on purpose: a suspended promoter may already have
   * PUBLISHED events carrying live predictions. Their existing cards must keep
   * resolving — deleting a published event would strand every pick made on it —
   * while every forward-looking capability stops. A single boolean cannot say
   * "may finish what is already running, may not start anything new".
   */
  | "SUSPENDED";

/**
 * What a promoter in a given state may do.
 *
 * A contract, not a convenience: every hosting surface asks this, so adding a
 * capability later is a field here plus a check at the call site — never a new
 * ad-hoc condition next to an existing one.
 */
export interface PromoterCapabilities {
  /** Create and edit DRAFT events. Drafts are private to the promoter. */
  draftEvents: boolean;
  /** Upload a poster and run extraction on it. */
  uploadPoster: boolean;
  /** Build the fight card: add bouts, assign fighters, reorder. */
  buildCard: boolean;
  /** Make an event PUBLIC. The capability that actually matters. */
  publishEvents: boolean;
  /** Record winners, methods, rounds and times on fight night. */
  recordResults: boolean;
  /** Show the Verified promoter badge on the public event page. */
  showBadge: boolean;
}

const NONE_ALLOWED: PromoterCapabilities = {
  draftEvents: false, uploadPoster: false, buildCard: false,
  publishEvents: false, recordResults: false, showBadge: false,
};

const CAPABILITIES: Record<PromoterState, PromoterCapabilities> = {
  NONE: NONE_ALLOWED,
  // ── A pending application may BUILD but never PUBLISH ────────────────────
  //
  // This is the distinction the capability table exists for, and it is worth
  // stating precisely because the gym model — which this otherwise mirrors —
  // grants a pending claim nothing at all.
  //
  // The difference is what the artefact IS. A gym page is a real, public,
  // pre-existing business listing, so letting an unreviewed claimant edit it
  // means an unreviewed stranger changing a business's public page. A promoter
  // DRAFT is none of those things: it is private to its author, it appears
  // nowhere, it takes no predictions, and it is invisible to every query on the
  // platform until `publishEvents` — which only VERIFIED holds — is exercised.
  //
  // So the risk of drafting is nil and the cost of forbidding it is real: the
  // first thing a new promoter would do on the platform is wait. They can build
  // the whole card while review happens and publish the moment it lands.
  //
  // The gate is withheld HERE, in the table every surface reads, rather than by
  // hiding a button — so there is no path that forgets it.
  CLAIM_PENDING: {
    draftEvents: true, uploadPoster: true, buildCard: true,
    publishEvents: false, recordResults: false, showBadge: false,
  },
  CLAIM_REJECTED: NONE_ALLOWED,
  VERIFIED: {
    draftEvents: true, uploadPoster: true, buildCard: true,
    publishEvents: true, recordResults: true, showBadge: true,
  },
  // SUSPENDED keeps exactly one right: recording results.
  //
  // Not a kindness to the promoter — a duty to the FANS. Predictions on an
  // already-published card cannot settle without a result, and an unsettled
  // card leaves every pick on it permanently pending. Removing the badge and
  // every create/publish right stops the harm going forward; keeping result
  // entry lets what is already in flight land. Staff can still enter results
  // through the admin path if the promoter is the problem.
  SUSPENDED: {
    draftEvents: false, uploadPoster: false, buildCard: false,
    publishEvents: false, recordResults: true, showBadge: false,
  },
};

export const promoterCapabilities = (state: PromoterState): PromoterCapabilities => CAPABILITIES[state];

/** The columns this derivation needs. Kept narrow so callers select only these. */
export interface PromoterStateInput {
  /** Staff-set flag on the promoter organisation. */
  verified: boolean;
  /** The account that owns the organisation, if one has been attached. */
  ownerId: string | null;
  /** Staff have withdrawn the right. Outranks everything. */
  suspendedAt: Date | null;
  /** Application statuses for this organisation. Order does not matter. */
  claimStatuses: string[];
}

/**
 * Derive the state. PURE.
 *
 * Precedence, and why:
 *   1. SUSPENDED first. A withdrawal has to beat a stale `verified` flag —
 *      otherwise un-verifying somebody means remembering to clear two columns,
 *      and the failure mode of forgetting is that they keep publishing.
 *   2. VERIFIED requires BOTH the flag and an owner. Either alone is
 *      half-finished: a flag with no owner has nobody to exercise the right,
 *      and an owner with no flag is the import/admin-fix case that would
 *      otherwise grant publishing silently.
 *   3. A PENDING application outranks a rejected one — somebody re-applied.
 *   4. APPROVED-but-not-flagged reports as still pending, not verified. Failing
 *      closed is the only safe direction for a publishing right.
 */
export function promoterState(input: PromoterStateInput): PromoterState {
  if (input.suspendedAt) return "SUSPENDED";
  if (input.verified && input.ownerId) return "VERIFIED";

  const statuses = new Set(input.claimStatuses.map((s) => s.toLowerCase()));
  // `info_requested` is still an open application from the applicant's point of
  // view — staff have asked a question, not said no.
  if (statuses.has("pending") || statuses.has("info_requested")) return "CLAIM_PENDING";
  if (statuses.has("approved")) return "CLAIM_PENDING";
  if (statuses.has("rejected")) return "CLAIM_REJECTED";
  return "NONE";
}

/** Human wording, so no surface invents its own. */
export const PROMOTER_STATE_COPY: Record<PromoterState, { label: string; detail: string }> = {
  NONE: {
    label: "Not a promoter",
    detail: "Run events? Apply to host them on Combat Reviews and manage your cards here.",
  },
  CLAIM_PENDING: {
    label: "Application under review",
    detail: "We're reviewing your promoter application. Hosting opens once that's done.",
  },
  CLAIM_REJECTED: {
    label: "Application declined",
    detail: "We couldn't verify this application. You're welcome to apply again with more detail.",
  },
  VERIFIED: {
    label: "Verified promoter",
    detail: "Verified by Combat Reviews. You can host events, build cards and record results.",
  },
  SUSPENDED: {
    label: "Hosting suspended",
    detail: "New events are paused on this account. You can still record results for cards already published.",
  },
};

/**
 * The one call every hosting surface makes.
 *
 * Returns a REASON on refusal rather than a bare false, because every caller
 * needs to say something to the promoter, and a caller that has to invent its
 * own wording will invent a different one on each surface.
 */
export function assertPromoterCan(
  state: PromoterState,
  capability: keyof PromoterCapabilities,
): { allowed: true } | { allowed: false; reason: string } {
  if (promoterCapabilities(state)[capability]) return { allowed: true };
  return { allowed: false, reason: PROMOTER_STATE_COPY[state].detail };
}
