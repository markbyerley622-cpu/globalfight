import "server-only";
import { prisma } from "@/lib/db";
import { slugify } from "@/lib/utils";
import { notify } from "@/lib/notifications-store";

// ════════════════════════════════════════════════════════════════════════════
//  THE FRONT DOOR — applying to host events, and staff deciding.
//
//  ── What signing up as a "promoter" does and does not do ──────────────────
//  Signup asks for an intent and `registryRole: "promoter"` records it. That is
//  a SELF-DECLARED label with no privilege — CLAUDE.md forbids gating any
//  authorization decision on it, because anyone can pick it from a dropdown.
//
//  So the signup choice does exactly one thing: it makes this door visible.
//  Walking through it — claiming an organisation, being reviewed, being
//  approved — is what actually grants anything, and the capability check
//  (lib/promoter/verification) reads the CLAIM and the staff flag, never the
//  label. Someone who signed up as a fan can apply; someone who signed up as a
//  promoter still cannot publish until a human says so.
// ════════════════════════════════════════════════════════════════════════════

export interface ClaimInput {
  /** Existing organisation to claim, or null when creating a new one. */
  promoterOrgId: string | null;
  /** Required when promoterOrgId is null. */
  newOrgName: string;
  /** Everything the applicant offers as evidence. Free text, shown to staff. */
  website: string;
  socials: string;
  contactEmail: string;
  phone: string;
  previousEvents: string;
  note: string;
}

/** Max length for any single free-text field on an application. */
const MAX_FIELD = 2000;

const clip = (s: string, max = 300) => s.trim().slice(0, max);

/**
 * Submit an application.
 *
 * Idempotent per (organisation, user) by the unique index, so a double-tap or
 * a re-application updates the existing row rather than racing the constraint
 * into a P2002 that would leak the index name (CLAUDE.md rules 4 and 5).
 */
export async function submitPromoterClaim(userId: string, input: ClaimInput): Promise<{ orgId: string }> {
  let orgId = input.promoterOrgId;

  if (!orgId) {
    const name = clip(input.newOrgName, 120);
    if (!name) throw new Error("What's the name of your promotion?");

    // A free slug. Not `upsert` on slug: two DIFFERENT promotions can legitimately
    // want similar names, and silently attaching an applicant to somebody else's
    // organisation because the slug collided is the worst possible outcome here.
    let slug = slugify(name) || "promotion";
    for (let n = 0; n < 40; n++) {
      const candidate = n === 0 ? slug : `${slug}-${n + 1}`;
      const taken = await prisma.promoterOrg.findUnique({ where: { slug: candidate }, select: { id: true } });
      if (!taken) { slug = candidate; break; }
    }

    const org = await prisma.promoterOrg.create({
      // verified:false and ownerId:null — creating the row grants NOTHING. The
      // organisation exists so staff have something to review; the rights come
      // from the decision.
      data: { name, slug },
      select: { id: true },
    });
    orgId = org.id;
  } else {
    const exists = await prisma.promoterOrg.findUnique({ where: { id: orgId }, select: { id: true } });
    if (!exists) throw new Error("That promotion no longer exists.");
  }

  const evidence = [
    input.website && `Website: ${clip(input.website, 500)}`,
    input.socials && `Socials: ${clip(input.socials, 500)}`,
    input.contactEmail && `Email: ${clip(input.contactEmail, 200)}`,
    input.phone && `Phone: ${clip(input.phone, 60)}`,
    input.previousEvents && `Previous events: ${clip(input.previousEvents, 1000)}`,
    input.note && `Note: ${clip(input.note, MAX_FIELD)}`,
  ].filter(Boolean).join("\n");

  await prisma.promoterClaim.upsert({
    where: { promoterOrgId_userId: { promoterOrgId: orgId, userId } },
    // Re-applying after a rejection reopens the SAME row rather than creating a
    // second one, so staff see one application per person per org with its full
    // history rather than a pile of duplicates.
    update: { status: "pending", note: evidence, reviewedAt: null, reviewedById: null },
    create: { promoterOrgId: orgId, userId, status: "pending", note: evidence },
  });

  return { orgId };
}

export type ClaimDecision = "approved" | "rejected" | "info_requested";

/**
 * Staff decide an application.
 *
 * ── Why approval writes THREE things ──────────────────────────────────────
 * The claim status alone is not enough: `promoterState` requires the staff
 * `verified` flag AND an `ownerId` before it grants anything, and it does that
 * deliberately so that an approval which half-landed fails CLOSED rather than
 * granting publishing rights on a status column alone. So approving sets all
 * three, in one transaction.
 *
 * The audit row is not optional either. A publishing right that can be granted
 * with no record of who granted it, when, or why is exactly the thing that
 * becomes unanswerable the first time a bogus event is published.
 */
export async function decidePromoterClaim(
  adminId: string,
  claimId: string,
  decision: ClaimDecision,
  reason: string,
): Promise<void> {
  const claim = await prisma.promoterClaim.findUnique({
    where: { id: claimId },
    select: { id: true, userId: true, promoterOrgId: true, promoterOrg: { select: { name: true } } },
  });
  if (!claim) throw new Error("That application no longer exists.");

  await prisma.$transaction(async (tx) => {
    await tx.promoterClaim.update({
      where: { id: claim.id },
      data: {
        status: decision,
        reviewedById: adminId,
        reviewedAt: new Date(),
        note: reason ? `${reason}` : undefined,
      },
    });

    if (decision === "approved") {
      await tx.promoterOrg.update({
        where: { id: claim.promoterOrgId },
        data: { verified: true, ownerId: claim.userId, suspendedAt: null },
      });
    }

    await tx.auditLog.create({
      data: {
        actorId: adminId,
        action: `promoter.claim.${decision}`,
        entity: "PromoterClaim",
        entityId: claim.id,
      },
    });
  });

  // Outside the transaction: notify() fires a push, and holding a database
  // transaction open across a third-party HTTP call turns a slow push provider
  // into lock contention.
  const copy = {
    approved: {
      title: "You're verified",
      body: `${claim.promoterOrg.name} can now host events on Combat Reviews.`,
      url: "/promoter",
    },
    rejected: {
      title: "Promoter application declined",
      body: reason || "We couldn't verify this application. You're welcome to apply again with more detail.",
      url: "/promoter",
    },
    info_requested: {
      title: "We need a bit more",
      body: reason || "We've asked for more detail on your promoter application.",
      url: "/promoter",
    },
  }[decision];

  await notify(prisma, claim.userId, {
    type: "IDENTITY_VERIFICATION",
    title: copy.title,
    body: copy.body,
    url: copy.url,
    icon: decision === "approved" ? "verified" : "person",
  }).catch(() => { /* a failed notification must not undo a recorded decision */ });
}

/** Organisations matching a search, for the "claim an existing one" step. */
export async function searchPromoterOrgs(q: string, limit = 8) {
  const term = q.trim().slice(0, 64);
  if (!term) return [];
  return prisma.promoterOrg.findMany({
    where: { name: { contains: term, mode: "insensitive" } },
    orderBy: { name: "asc" },
    take: limit,
    select: { id: true, name: true, verified: true, ownerId: true },
  });
}

/** The review queue. Oldest first — an application waiting longest is next. */
export async function listPendingPromoterClaims(limit = 50) {
  const rows = await prisma.promoterClaim.findMany({
    where: { status: { in: ["pending", "info_requested"] } },
    orderBy: { createdAt: "asc" },
    take: limit,
    select: {
      id: true, status: true, note: true, createdAt: true,
      user: { select: { id: true, username: true, name: true, image: true, createdAt: true } },
      promoterOrg: {
        select: {
          id: true, name: true, slug: true, verified: true, ownerId: true,
          _count: { select: { events: true } },
        },
      },
    },
  });
  return rows;
}
