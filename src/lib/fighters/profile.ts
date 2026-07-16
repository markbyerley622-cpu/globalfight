// ════════════════════════════════════════════════════════════════════════
//  Fighter website + profile-claiming data layer (Postgres / Prisma).
//  Powers the public site at /fighters/[slug], the owner dashboard, the claim
//  flow and the /admin/claims panel. No mock data.
// ════════════════════════════════════════════════════════════════════════

import "server-only";
import { prisma } from "@/lib/db";
import { imageProxyUrl } from "@/lib/media-safe";
import {
  deleteClaimEvidence, daysFromNow, APPEAL_WINDOW_DAYS, PENDING_TTL_DAYS,
} from "@/lib/evidence/lifecycle";

const isoOrNull = (d: Date | null) => (d ? d.toISOString() : null);

export interface PublicProfile {
  slug: string; name: string; nickname: string | null; sport: string;
  nationality: string | null; countryCode: string | null; residence: string | null; active: boolean;
  wins: number; losses: number; draws: number; noContests: number; koWins: number;
  bio: string | null; gym: string | null; promoter: string | null; tagline: string | null;
  website: string | null; instagram: string | null; twitter: string | null; contactEmail: string | null;
  imageUrl: string | null; heroImageUrl: string | null; thumbUrl: string | null;
  // Attribution for a free-licensed Commons photo (null when the image is our own).
  photoCredit: string | null; photoLicense: string | null; photoLicenseUrl: string | null; photoSource: string | null;
  beltRank: string | null; style: string | null; federation: string | null; rank: string | null;
  profileKind: string; claimed: boolean; ownerId: string | null;
  achievements: { id: string; title: string; year: number | null }[];
  sponsors: { id: string; name: string; url: string | null; logoUrl: string | null }[];
  socials: { id: string; platform: string; url: string }[];
  photos: { id: string; url: string; caption: string | null }[];
  videos: { id: string; url: string; caption: string | null }[];
}

export async function getFighterPublicProfile(slug: string): Promise<PublicProfile | null> {
  const f = await prisma.fighter.findUnique({
    where: { slug },
    include: {
      achievements: { orderBy: { order: "asc" } },
      sponsors: { orderBy: { order: "asc" } },
      socials: true,
      media: { orderBy: { order: "asc" } },
    },
  });
  if (!f) return null;
  // Prefer our own stored image; else a free-licensed Commons photo via the proxy.
  const licensed = !f.imageUrl && f.photoLicense ? imageProxyUrl(f.photoUrl) : null;
  return {
    slug: f.slug, name: f.name, nickname: f.nickname, sport: f.sport,
    nationality: f.nationality, countryCode: f.countryCode, residence: f.residence, active: f.active,
    wins: f.wins, losses: f.losses, draws: f.draws, noContests: f.noContests, koWins: f.koWins,
    bio: f.bio, gym: f.gym, promoter: f.promoter, tagline: f.tagline,
    website: f.website, instagram: f.instagram, twitter: f.twitter, contactEmail: f.contactEmail,
    imageUrl: f.imageUrl ?? licensed, heroImageUrl: f.heroImageUrl ?? licensed, thumbUrl: f.thumbUrl ?? licensed,
    photoCredit: f.photoCredit, photoLicense: f.photoLicense, photoLicenseUrl: f.photoLicenseUrl, photoSource: f.photoSource,
    beltRank: f.beltRank, style: f.style, federation: f.federation, rank: f.rank,
    profileKind: f.profileKind, claimed: f.claimed, ownerId: f.ownerId,
    achievements: f.achievements.map((a) => ({ id: a.id, title: a.title, year: a.year })),
    sponsors: f.sponsors.map((s) => ({ id: s.id, name: s.name, url: s.url, logoUrl: s.logoUrl })),
    socials: f.socials.map((s) => ({ id: s.id, platform: s.platform, url: s.url })),
    photos: f.media.filter((m) => m.type === "photo").map((m) => ({ id: m.id, url: m.url, caption: m.caption })),
    videos: f.media.filter((m) => m.type === "video").map((m) => ({ id: m.id, url: m.url, caption: m.caption })),
  };
}

// ── Ownership guard ───────────────────────────────────────────────────────
async function ownedFighter(userId: string, slug: string): Promise<string> {
  const f = await prisma.fighter.findUnique({ where: { slug }, select: { id: true, ownerId: true } });
  if (!f) throw new Error("Profile not found.");
  if (f.ownerId !== userId) throw new Error("You don't own this profile.");
  return f.id;
}

async function audit(actorId: string | null, action: string, entity: string, entityId: string, meta?: object) {
  await prisma.auditLog.create({ data: { actorId, action, entity, entityId, meta: meta ?? undefined } });
}

// ── Owner content management ───────────────────────────────────────────────
export async function updateProfileMeta(userId: string, slug: string, data: {
  bio?: string; tagline?: string; contactEmail?: string;
  imageUrl?: string; heroImageUrl?: string; website?: string; instagram?: string; twitter?: string;
}) {
  const id = await ownedFighter(userId, slug);
  await prisma.fighter.update({
    where: { id },
    data: {
      bio: data.bio?.trim() || null,
      tagline: data.tagline?.trim() || null,
      contactEmail: data.contactEmail?.trim() || null,
      imageUrl: data.imageUrl?.trim() || undefined,
      heroImageUrl: data.heroImageUrl?.trim() || undefined,
      website: data.website?.trim() || null,
      instagram: data.instagram?.trim() || null,
      twitter: data.twitter?.trim() || null,
    },
  });
}

/**
 * Set the fighter's photo from their own upload. Writes all three cached
 * variants onto the Fighter row, so the new photo propagates everywhere the
 * avatar is read (directory, rankings, P4P, profile hero, opponent cards).
 */
export async function setFighterAvatar(
  userId: string, slug: string, images: { thumbUrl: string; imageUrl: string; heroImageUrl: string },
) {
  const id = await ownedFighter(userId, slug);
  await prisma.fighter.update({
    where: { id },
    data: {
      thumbUrl: images.thumbUrl, imageUrl: images.imageUrl, heroImageUrl: images.heroImageUrl,
      lastProfileScrapedAt: new Date(),
    },
  });
  await audit(userId, "fighter.avatar.update", "Fighter", id, {});
}

export async function addAchievement(userId: string, slug: string, title: string, year?: number) {
  const fighterId = await ownedFighter(userId, slug);
  return prisma.fighterAchievement.create({ data: { fighterId, title: title.trim(), year: year ?? null } });
}
export async function addSponsor(userId: string, slug: string, name: string, url?: string, logoUrl?: string) {
  const fighterId = await ownedFighter(userId, slug);
  return prisma.fighterSponsor.create({ data: { fighterId, name: name.trim(), url: url?.trim() || null, logoUrl: logoUrl?.trim() || null } });
}
export async function setSocial(userId: string, slug: string, platform: string, url: string) {
  const fighterId = await ownedFighter(userId, slug);
  return prisma.fighterSocial.upsert({
    where: { fighterId_platform: { fighterId, platform } },
    create: { fighterId, platform, url: url.trim() },
    update: { url: url.trim() },
  });
}
export async function addMedia(userId: string, slug: string, type: "photo" | "video", url: string, caption?: string) {
  const fighterId = await ownedFighter(userId, slug);
  return prisma.fighterMedia.create({ data: { fighterId, type, url: url.trim(), caption: caption?.trim() || null } });
}
export async function deleteChild(userId: string, kind: "achievement" | "sponsor" | "social" | "media", id: string) {
  // Verify the child belongs to a fighter the user owns.
  const map = {
    achievement: () => prisma.fighterAchievement.findUnique({ where: { id }, select: { fighter: { select: { ownerId: true } } } }),
    sponsor: () => prisma.fighterSponsor.findUnique({ where: { id }, select: { fighter: { select: { ownerId: true } } } }),
    social: () => prisma.fighterSocial.findUnique({ where: { id }, select: { fighter: { select: { ownerId: true } } } }),
    media: () => prisma.fighterMedia.findUnique({ where: { id }, select: { fighter: { select: { ownerId: true } } } }),
  } as const;
  const row = await map[kind]();
  if (!row) throw new Error("Not found.");
  if (row.fighter.ownerId !== userId) throw new Error("You don't own this profile.");
  if (kind === "achievement") await prisma.fighterAchievement.delete({ where: { id } });
  else if (kind === "sponsor") await prisma.fighterSponsor.delete({ where: { id } });
  else if (kind === "social") await prisma.fighterSocial.delete({ where: { id } });
  else await prisma.fighterMedia.delete({ where: { id } });
}

// ── Claim flow ─────────────────────────────────────────────────────────────
export async function getMyClaim(userId: string, slug: string) {
  const f = await prisma.fighter.findUnique({ where: { slug }, select: { id: true } });
  if (!f) return null;
  const c = await prisma.fighterClaim.findUnique({
    where: { fighterId_claimantId: { fighterId: f.id, claimantId: userId } },
    select: { status: true, createdAt: true, reviewNote: true },
  });
  return c ? { status: c.status, createdAt: c.createdAt.toISOString(), reviewNote: c.reviewNote } : null;
}

/**
 * Open (or re-open) a claim.
 *
 * Note what is NOT a parameter any more: an evidence URL. The client used to hand
 * us the storage URL its upload returned, which meant a caller could point their
 * claim at any URL at all — including another claimant's document. The identity
 * document is now attached server-side by the upload route, keyed on
 * (fighterId, claimantId), so it can only ever be the caller's own.
 *
 * `evidenceNote` is free text the claimant writes; `evidenceType` is a label.
 * Neither can reference stored bytes.
 */
export async function createClaim(userId: string, slug: string, evidence: {
  evidenceType?: string; evidenceNote?: string;
}) {
  const f = await prisma.fighter.findUnique({ where: { slug }, select: { id: true, ownerId: true } });
  if (!f) throw new Error("Profile not found.");
  if (f.ownerId) throw new Error("This profile is already verified to an owner.");
  const existing = await prisma.fighterClaim.findUnique({
    where: { fighterId_claimantId: { fighterId: f.id, claimantId: userId } },
    select: { status: true },
  });
  if (existing && (existing.status === "PENDING" || existing.status === "APPROVED")) {
    throw new Error("You already have a claim on this profile.");
  }
  const claim = await prisma.fighterClaim.upsert({
    where: { fighterId_claimantId: { fighterId: f.id, claimantId: userId } },
    create: {
      fighterId: f.id, claimantId: userId, status: "PENDING",
      evidenceType: evidence.evidenceType ?? null,
      evidenceNote: evidence.evidenceNote ?? null,
    },
    update: {
      status: "PENDING", evidenceType: evidence.evidenceType ?? null,
      evidenceNote: evidence.evidenceNote ?? null,
      reviewerId: null, reviewNote: null, reviewedAt: null,
    },
  });
  await audit(userId, "claim.create", "FighterClaim", claim.id, { fighterId: f.id });
  return claim;
}

/**
 * Claims for the review queue.
 *
 * Deliberately returns NO storage key, provider, or URL — a reviewer's browser is
 * given `hasEvidence` and nothing more, and fetches the document itself from the
 * authorized streaming endpoint. Handing storage identifiers to a client is how
 * they end up in logs, referrers, and screenshots.
 */
export async function listClaims(status?: string) {
  const rows = await prisma.fighterClaim.findMany({
    where: status ? { status } : undefined,
    orderBy: { createdAt: "desc" },
    take: 200,
    include: {
      fighter: { select: { slug: true, name: true, sport: true } },
      claimant: { select: { name: true, username: true, email: true } },
      reviewer: { select: { name: true, username: true } },
    },
  });
  return rows.map((c) => ({
    id: c.id, status: c.status,
    fighterSlug: c.fighter.slug, fighterName: c.fighter.name, sport: c.fighter.sport,
    claimantName: c.claimant.name ?? c.claimant.username ?? "User", claimantEmail: c.claimant.email,
    evidenceType: c.evidenceType, evidenceNote: c.evidenceNote,
    // Presence + content type only. The bytes come from GET /api/claims/<id>/evidence.
    hasEvidence: Boolean(c.evidenceStorageKey) && !c.evidenceDeletedAt,
    evidenceContentType: c.evidenceContentType,
    evidenceScanStatus: c.evidenceScanStatus,
    evidenceDeletedAt: isoOrNull(c.evidenceDeletedAt),
    reviewerName: c.reviewer?.name ?? c.reviewer?.username ?? null, reviewNote: c.reviewNote,
    createdAt: c.createdAt.toISOString(), reviewedAt: isoOrNull(c.reviewedAt),
  }));
}

/**
 * Approve / reject / request-info on a claim.
 *
 * Evidence retention is enforced HERE, at the moment the document stops being
 * needed. Sequencing (and it must stay in this order):
 *
 *   1. commit the claim state transition in a transaction — the decision is what
 *      must be durable;
 *   2. THEN delete the identity document(s);
 *   3. deleteClaimEvidence() nulls the DB reference only after the object is
 *      actually gone, and records FAILED (keeping the key) if it isn't.
 *
 * Step 2 is deliberately outside the transaction: an object-store call is a
 * network operation that can hang or fail, and rolling back a completed approval
 * because a bucket was briefly unreachable would be worse than a retry. A failure
 * is not silent — it is recorded as FAILED and re-attempted by the cleanup job
 * (src/lib/evidence/lifecycle.ts), so the document cannot be quietly retained.
 */
export async function reviewClaim(reviewerId: string, claimId: string, action: "approve" | "reject" | "info", note?: string) {
  const claim = await prisma.fighterClaim.findUnique({
    where: { id: claimId },
    include: { fighter: { select: { id: true, ownerId: true } } },
  });
  if (!claim) throw new Error("Claim not found.");
  if (claim.claimantId === reviewerId) throw new Error("You cannot review your own claim.");
  if (claim.status === "APPROVED" || claim.status === "REJECTED") throw new Error("This claim is already resolved.");

  if (action === "approve") {
    if (claim.fighter.ownerId) throw new Error("This profile already has an owner.");

    const superseded = await prisma.fighterClaim.findMany({
      where: { fighterId: claim.fighter.id, status: { in: ["PENDING", "INFO_REQUESTED"] }, id: { not: claimId } },
      select: { id: true },
    });

    await prisma.$transaction([
      prisma.fighter.update({ where: { id: claim.fighter.id }, data: { ownerId: claim.claimantId, claimed: true } }),
      prisma.fighterClaim.update({ where: { id: claimId }, data: { status: "APPROVED", reviewerId, reviewNote: note ?? null, reviewedAt: new Date() } }),
      prisma.fighterClaim.updateMany({
        where: { fighterId: claim.fighter.id, status: { in: ["PENDING", "INFO_REQUESTED"] }, id: { not: claimId } },
        data: { status: "REJECTED", reviewNote: "Superseded by an approved claim.", reviewedAt: new Date(), reviewerId },
      }),
    ]);
    await audit(reviewerId, "claim.approve", "FighterClaim", claimId, { fighterId: claim.fighter.id, newOwnerId: claim.claimantId });

    // The claim is decided; the ID has served its purpose. Delete it now — an
    // approved claim must never leave a passport in storage.
    await deleteClaimEvidence(claimId, "claim.approved");
    // Losing claimants' documents are equally done with.
    for (const s of superseded) await deleteClaimEvidence(s.id, "claim.superseded");

  } else if (action === "reject") {
    await prisma.fighterClaim.update({
      where: { id: claimId },
      data: {
        status: "REJECTED", reviewerId, reviewNote: note ?? null, reviewedAt: new Date(),
        // Keep the document only for the appeal window, then it is swept.
        evidenceDeleteAfter: daysFromNow(APPEAL_WINDOW_DAYS),
      },
    });
    await audit(reviewerId, "claim.reject", "FighterClaim", claimId, {});

  } else {
    // INFO_REQUESTED — the claimant still needs to act, so the document stays for
    // now, but the abandonment clock is reset rather than removed.
    await prisma.fighterClaim.update({
      where: { id: claimId },
      data: {
        status: "INFO_REQUESTED", reviewerId, reviewNote: note ?? null,
        evidenceDeleteAfter: daysFromNow(PENDING_TTL_DAYS),
      },
    });
    await audit(reviewerId, "claim.info", "FighterClaim", claimId, {});
  }
}
