import "server-only";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { retainMedia, releaseMedia, isServable } from "@/lib/media/asset/lifecycle";
import { assertPublicKey } from "@/lib/media/asset/keys";
import { MAX_MEDIA_PER_POST, MAX_ALT_CHARS, MAX_CAPTION_CHARS, type PostMediaDTO } from "./types";

// ════════════════════════════════════════════════════════════════════════════
//  THE ONLY PLACE GYM POSTS TOUCH THE MEDIA LIFECYCLE.
//
//  Everything about storage that a post is allowed to know passes through this
//  file, and it is deliberately small. It calls retainMedia / releaseMedia /
//  isServable — it does not reimplement any of them, does not talk to a bucket,
//  and does not know what a bucket is.
//
//  ── The reference contract ───────────────────────────────────────────────
//  A GymPostMedia ROW IS A REFERENCE. Creating one takes a reference; removing
//  one releases it. There is no other way for this domain to move refCount.
//
//  ── Ordering, and which way it is allowed to fail ────────────────────────
//  These two writes are not in one transaction — refCount lives on a different
//  table and lifecycle.ts owns it. So the ORDER decides what a crash between
//  them costs:
//
//    attach:  retain FIRST, then insert the row.
//    detach:  delete the row FIRST, then release.
//
//  Both orders fail toward OVER-counting. An over-counted asset is never
//  collected — it costs storage. An under-counted one gets swept while a live
//  post still points at it — it costs the reader a broken image and the author
//  their photo. That is the same conservative direction cleanupMedia already
//  chose, and it is chosen here for the same reason.
//
//  ── Why attachment does NOT check who uploaded the asset ─────────────────
//  It looks like an obvious control and it is actually the wrong one, twice.
//
//  It breaks dedupe, which is the entire point of hashing: when two members
//  upload the same gym flyer they are handed the SAME asset row, whose ownerId
//  records whoever arrived first. An ownerId check would refuse the second
//  member their own upload.
//
//  And it protects nothing. Only READY assets can be attached, and a READY
//  asset is already world-readable at its public URL — that is what READY
//  means. Guessing an id would yield a picture anybody could already fetch. The
//  real controls on re-posting someone's photo are rate limits and moderation,
//  which are content controls, because re-posting is a content problem.
//
//  If this pipeline ever carries media that is NOT public-by-URL, that changes,
//  and the fix is a per-user upload grant — not an ownerId check that dedupe
//  would defeat anyway.
// ════════════════════════════════════════════════════════════════════════════

export interface AttachmentInput {
  assetId: string;
  alt?: string | null;
  caption?: string | null;
}

/** What the caller asked for, cleaned: deduped, trimmed, capped, ordered. */
export function normaliseAttachments(raw: unknown): AttachmentInput[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const out: AttachmentInput[] = [];
  for (const item of raw) {
    const assetId = typeof item === "string" ? item : (item as AttachmentInput)?.assetId;
    if (typeof assetId !== "string" || !assetId || seen.has(assetId)) continue;
    seen.add(assetId);
    const o = (typeof item === "object" && item !== null ? item : {}) as AttachmentInput;
    out.push({
      assetId,
      alt: typeof o.alt === "string" ? o.alt.trim().slice(0, MAX_ALT_CHARS) || null : null,
      caption: typeof o.caption === "string" ? o.caption.trim().slice(0, MAX_CAPTION_CHARS) || null : null,
    });
    if (out.length >= MAX_MEDIA_PER_POST) break;
  }
  return out;
}

/**
 * Refuse anything that is not servable.
 *
 * ONE query for the whole set, not one per asset — a ten-image post must not be
 * ten round-trips. Throws a user-facing sentence (CLAUDE.md rule 5: our words,
 * never an ORM error) naming the count rather than the id, because an id tells
 * the uploader nothing and tells a prober something.
 */
export async function assertAttachable(assetIds: string[]): Promise<void> {
  if (assetIds.length === 0) return;
  if (assetIds.length > MAX_MEDIA_PER_POST) {
    throw new Error(`A post can carry ${MAX_MEDIA_PER_POST} images.`);
  }
  const assets = await prisma.mediaAsset.findMany({
    where: { id: { in: assetIds } },
    select: { id: true, status: true },
  });
  const byId = new Map(assets.map((a) => [a.id, a.status]));
  const bad = assetIds.filter((id) => {
    const status = byId.get(id);
    return status === undefined || !isServable(status);
  });
  if (bad.length > 0) {
    // Covers "never existed", "still scanning", "rejected" and "swept" with one
    // message on purpose: distinguishing them for the caller would report on
    // another member's upload, and the fix is the same in every case.
    throw new Error(
      bad.length === assetIds.length
        ? "Those images aren't ready yet. Upload them again."
        : `${bad.length} of those images aren't ready yet. Remove them or upload them again.`,
    );
  }
}

/**
 * Attach assets to a post, taking one reference each.
 *
 * `skipDuplicates` is not used: the reference has to be taken exactly once per
 * row actually created, and createMany reports only a total. Inserting one at a
 * time and tolerating the unique violation is what keeps "row created" and
 * "reference taken" in step — a double-submitted PATCH must not double-count.
 */
export async function attachMedia(postId: string, items: AttachmentInput[]): Promise<number> {
  let attached = 0;
  for (const [index, item] of items.entries()) {
    // Retain BEFORE the row exists. See the header for why this order.
    await retainMedia(item.assetId);
    try {
      await prisma.gymPostMedia.create({
        data: {
          postId,
          assetId: item.assetId,
          sortOrder: index,
          alt: item.alt ?? null,
          caption: item.caption ?? null,
        },
        select: { id: true },
      });
      attached += 1;
    } catch (e) {
      // Already attached — the reference we just took is one too many, so give
      // it straight back. Anything else is a real failure and must surface.
      if ((e as { code?: string }).code !== "P2002") {
        await releaseMedia(item.assetId).catch(() => {});
        throw e;
      }
      await releaseMedia(item.assetId).catch(() => {});
    }
  }
  return attached;
}

/**
 * Remove every attachment on a post and release its references.
 *
 * Called when a post is deleted, and by the edit path for assets the author
 * dropped. Rows are deleted first (see the header); the asset rows themselves
 * are untouched — refCount reaching zero only makes them ELIGIBLE for the
 * cleanup sweep, which is lifecycle.ts's decision to make, not this module's.
 */
export async function detachAllMedia(postId: string): Promise<number> {
  const rows = await prisma.gymPostMedia.findMany({
    where: { postId },
    select: { id: true, assetId: true },
  });
  if (rows.length === 0) return 0;

  const { count } = await prisma.gymPostMedia.deleteMany({
    where: { id: { in: rows.map((r) => r.id) } },
  });
  // Release exactly as many references as rows we actually removed. A concurrent
  // delete that got there first shows up as a smaller count, and releasing for
  // rows we did not delete is precisely the double-release that would drive an
  // asset to zero while another post still holds it.
  if (count > 0) {
    for (const row of rows.slice(0, count)) await releaseMedia(row.assetId).catch(() => {});
  }
  return count;
}

/** Detach specific assets (the edit path), releasing one reference each. */
export async function detachMedia(postId: string, assetIds: string[]): Promise<number> {
  if (assetIds.length === 0) return 0;
  const rows = await prisma.gymPostMedia.findMany({
    where: { postId, assetId: { in: assetIds } },
    select: { id: true, assetId: true },
  });
  let removed = 0;
  for (const row of rows) {
    // deleteMany, not delete: a row already gone must affect zero rows rather
    // than throw a P2025 that would leak the model name (CLAUDE.md rule 5).
    const { count } = await prisma.gymPostMedia.deleteMany({ where: { id: row.id } });
    if (count === 1) {
      await releaseMedia(row.assetId).catch(() => {});
      removed += 1;
    }
  }
  return removed;
}

// ─── Rendering ──────────────────────────────────────────────────────────────

/** The columns a rendered attachment needs. One include, used everywhere. */
export const MEDIA_INCLUDE = {
  orderBy: [{ sortOrder: "asc" }, { id: "asc" }],
  select: {
    id: true,
    alt: true,
    caption: true,
    asset: {
      select: {
        id: true, status: true, publicKey: true, variants: true,
        width: true, height: true, blurhash: true,
      },
    },
  },
} satisfies Prisma.GymPost$mediaArgs;

type MediaRow = {
  id: string;
  alt: string | null;
  caption: string | null;
  asset: {
    id: string; status: string; publicKey: string | null;
    variants: Prisma.JsonValue; width: number; height: number; blurhash: string | null;
  };
};

/**
 * Turn stored rows into something a browser can render.
 *
 * Three refusals, all silent (the attachment is dropped from the list rather
 * than erroring the whole post — one asset swept by cleanup must not 500 a
 * page):
 *   • not READY — an asset that regressed after attachment;
 *   • no publicKey — nothing was ever published for it;
 *   • the key is not in the public zone — assertPublicKey throws, and that
 *     throw is the code boundary that the three storage prefixes are policy
 *     without. It should be impossible; if it ever fires, something wrote a
 *     temp or quarantine key where a published one belongs.
 */
export function renderMedia(rows: MediaRow[]): PostMediaDTO[] {
  const out: PostMediaDTO[] = [];
  for (const row of rows) {
    const a = row.asset;
    if (!isServable(a.status as never) || !a.publicKey) continue;
    try {
      assertPublicKey(a.publicKey);
    } catch {
      continue;
    }
    const variants = (a.variants ?? {}) as Record<string, unknown>;
    const url = pick(variants, "full", "url", "imageUrl", "hero", "heroImageUrl");
    const thumbUrl = pick(variants, "thumb", "thumbUrl") ?? url;
    if (!url) continue;

    out.push({
      id: row.id,
      url,
      thumbUrl: thumbUrl ?? url,
      width: a.width,
      height: a.height,
      alt: row.alt,
      caption: row.caption,
      blurhash: a.blurhash,
    });
  }
  return out;
}

/**
 * First present string among the candidate variant names.
 *
 * The variant SET is explicitly allowed to change (that is why it is JSON and
 * not columns), so a reader that hard-codes one name breaks the day AVIF or a
 * video poster is added. This accepts the names the pipeline has used and falls
 * through in preference order.
 */
function pick(variants: Record<string, unknown>, ...names: string[]): string | null {
  for (const n of names) {
    const v = variants[n];
    if (typeof v === "string" && v) return v;
  }
  return null;
}

/** Widest attached image, for the ranker's media-quality signal. */
export function widestOf(media: PostMediaDTO[]): number {
  return media.reduce((max, m) => (m.width > max ? m.width : max), 0);
}

/**
 * A just-uploaded asset, described well enough for the composer to preview it.
 *
 * Goes through renderMedia so the preview obeys the SAME three refusals as a
 * published post — a composer that could show something the feed refuses to
 * would be showing the uploader a picture nobody else will ever see.
 */
export async function previewAsset(assetId: string): Promise<PostMediaDTO | null> {
  const asset = await prisma.mediaAsset.findUnique({
    where: { id: assetId },
    select: {
      id: true, status: true, publicKey: true, variants: true,
      width: true, height: true, blurhash: true,
    },
  });
  if (!asset) return null;
  const [dto] = renderMedia([{ id: assetId, alt: null, caption: null, asset }]);
  return dto ?? null;
}
