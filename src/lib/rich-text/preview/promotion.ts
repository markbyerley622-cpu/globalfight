import "server-only";
import { prisma } from "@/lib/db";
import { promotionBySlug } from "@/lib/promotions";
import { registerPreviewLoader } from "./registry";

// ════════════════════════════════════════════════════════════════════════════
//  A PROMOTION's preview.
//
//  ── The one kind whose "id" is not a database key ─────────────────────────
//  A promotion is an entry in the in-code registry (lib/promotions), so the
//  stored entity id IS its slug. Identity therefore costs no query at all; the
//  only thing the database is asked is how many events are still to come.
//
//  Access-control walk: read-only, public, no writes. An unrecognised slug is
//  absent from the result — the registry lookup simply returns nothing, which
//  the cache reads as `missing`.
// ════════════════════════════════════════════════════════════════════════════

registerPreviewLoader("promotion", async (ids) => {
  const known = ids
    .map((id) => promotionBySlug(id))
    .filter((p): p is NonNullable<typeof p> => Boolean(p));
  if (known.length === 0) return [];

  const now = new Date();
  // ONE grouped count for the whole batch rather than a count per promotion.
  const counts = await prisma.event.groupBy({
    by: ["promotionId"],
    where: { promotionId: { in: known.map((p) => p.slug) }, date: { gte: now } },
    _count: { _all: true },
  });
  const byId = new Map(counts.map((c) => [c.promotionId, c._count._all]));

  return known.map((p) => ({
    kind: "promotion",
    id: p.slug,
    slug: p.slug,
    name: p.name,
    mark: p.mark,
    upcomingEvents: byId.get(p.slug) ?? 0,
    website: null,
  }));
});
