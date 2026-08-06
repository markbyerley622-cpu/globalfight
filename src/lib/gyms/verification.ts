// ════════════════════════════════════════════════════════════════════════════
//  GYM VERIFICATION STATE — one definition, and the capabilities it unlocks.
//
//  ── Why a state machine and not a boolean ────────────────────────────────
//  The data for this already existed in three places: `Gym.ownerId` (has an
//  owner), `Gym.verified` (a flag staff can set), and `GymClaim.status`
//  (pending / approved / rejected / info_requested). Nothing combined them, so
//  every surface that wanted to know "can this gym publish?" had to re-derive
//  it — and the honest answer needs all three. A gym with an owner but an
//  unreviewed claim is not the same as a verified one, and a boolean cannot
//  express the difference.
//
//  The consequence of not having this: the only gate on publishing was "are you
//  the owner", which is set the moment a claim is APPROVED but says nothing
//  about whether review actually happened for gyms whose ownerId was set by
//  import or by an admin fixing data. Publishing rights were effectively
//  ownership rights.
//
//  ── Why it is worth the ceremony ─────────────────────────────────────────
//  It is what makes the "Verified" badge mean something. A badge that appears
//  the moment someone clicks "claim" is decoration; one that appears after a
//  human looked at a business licence is a trust signal, and the whole point of
//  a registry is that its trust signals are load-bearing.
//
//  ── Designed to generalise ───────────────────────────────────────────────
//  Promoters, federations and commissions will need exactly this: unclaimed
//  listing → claim under review → verified organisation with a dashboard. The
//  STATES and the CAPABILITY shape below are deliberately not gym-specific, so
//  the next entity reuses this model rather than growing a second one.
// ════════════════════════════════════════════════════════════════════════════

/** Where a gym sits on the path from imported listing to verified organisation. */
export type GymVerificationState =
  /** Imported into the registry. Read-only; nobody has asked for it. */
  | "UNCLAIMED"
  /** Someone has claimed it and staff have not decided yet. Still read-only. */
  | "CLAIM_PENDING"
  /** A claim was refused. Read-only, and a new claim is allowed. */
  | "CLAIM_REJECTED"
  /** Reviewed and approved. The full dashboard is open. */
  | "VERIFIED";

/**
 * What a gym in a given state may do.
 *
 * Read as a contract rather than a convenience: every publishing surface asks
 * this, so adding a capability later is a field here and a check at the call
 * site — never a new ad-hoc condition.
 */
export interface GymCapabilities {
  /** Edit name, description, contact, hours, disciplines. */
  editProfile: boolean;
  /** Upload logo, cover and gallery images. */
  manageMedia: boolean;
  /** Publish to the gym's media feed. */
  publishPosts: boolean;
  /** Publish community events (seminars, open mats, gradings). */
  publishEvents: boolean;
  /** Add and remove coaches and members. */
  manageRoster: boolean;
  /** Show the Verified badge. */
  showBadge: boolean;
}

const NONE: GymCapabilities = {
  editProfile: false, manageMedia: false, publishPosts: false,
  publishEvents: false, manageRoster: false, showBadge: false,
};

const CAPABILITIES: Record<GymVerificationState, GymCapabilities> = {
  UNCLAIMED: NONE,
  // A pending claim grants NOTHING. This is the decision that makes the model
  // worth having: the tempting shortcut is to let a claimant start filling the
  // page in while review happens, and that is precisely how an unverified
  // stranger publishes to a business's page. Review first.
  CLAIM_PENDING: NONE,
  CLAIM_REJECTED: NONE,
  VERIFIED: {
    editProfile: true, manageMedia: true, publishPosts: true,
    publishEvents: true, manageRoster: true, showBadge: true,
  },
};

export const gymCapabilities = (state: GymVerificationState): GymCapabilities => CAPABILITIES[state];

/** The columns this derivation needs. Kept narrow so callers select only these. */
export interface GymVerificationInput {
  ownerId: string | null;
  verified: boolean;
  /** Claim statuses for this gym. Order does not matter. */
  claimStatuses: string[];
}

/**
 * Derive the state. PURE — no database, so it is unit-testable and cannot
 * disagree with itself between surfaces.
 *
 * Precedence is deliberate:
 *   1. VERIFIED requires BOTH an owner and the staff flag. Either alone is a
 *      half-finished state: a flag with no owner has nobody to exercise the
 *      rights, and an owner with no flag is the import/admin-fix case that used
 *      to grant publishing rights silently.
 *   2. A PENDING claim outranks a rejected one — someone has re-applied.
 *   3. Otherwise the most recent decision that exists, else UNCLAIMED.
 */
export function gymVerificationState(input: GymVerificationInput): GymVerificationState {
  if (input.verified && input.ownerId) return "VERIFIED";

  const statuses = new Set(input.claimStatuses.map((s) => s.toLowerCase()));
  // `info_requested` is still an open claim from the claimant's point of view —
  // staff have asked a question, not said no.
  if (statuses.has("pending") || statuses.has("info_requested")) return "CLAIM_PENDING";
  // Approved but NOT flagged verified: the approval landed and the flag did not.
  // Reported as still-under-review rather than verified — failing closed is the
  // only safe direction for a publishing right, and this is exactly the gap that
  // used to grant publishing on ownerId alone.
  if (statuses.has("approved")) return "CLAIM_PENDING";
  if (statuses.has("rejected")) return "CLAIM_REJECTED";
  return "UNCLAIMED";
}

/** Human wording, so no surface invents its own. */
export const STATE_COPY: Record<GymVerificationState, { label: string; detail: string }> = {
  UNCLAIMED: {
    label: "Unclaimed",
    detail: "This listing was imported from public records. If you run this gym, claim it to manage the page.",
  },
  CLAIM_PENDING: {
    label: "Claim under review",
    detail: "Someone has claimed this gym and we're reviewing the evidence. The page stays read-only until that's done.",
  },
  CLAIM_REJECTED: {
    label: "Unclaimed",
    detail: "This listing was imported from public records. If you run this gym, claim it to manage the page.",
  },
  VERIFIED: {
    label: "Verified gym",
    detail: "Ownership of this page has been verified by Combat Reviews.",
  },
};
