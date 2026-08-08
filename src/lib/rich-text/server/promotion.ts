import "server-only";
import { prisma } from "@/lib/db";
import { promotionBySlug } from "@/lib/promotions";
import { registerEntitySource } from "./registry";

// ════════════════════════════════════════════════════════════════════════════
//  A PROMOTION.
//
//  ── The one kind whose id is not a database key ───────────────────────────
//  A promotion is an entry in the in-code registry (lib/promotions), not a row
//  we own. So its id IS its slug, and `resolve` costs no query at all — the
//  key and the id are the same value, which is exactly why the interface takes
//  keys rather than ids everywhere. Only the upcoming-event count touches the
//  database.
//
//  No `suggest`: not offered by any composer yet. See the gym source.
//
//  Access-control walk: public reads, no session, no writes.
// ════════════════════════════════════════════════════════════════════════════

registerEntitySource({
  kind: "promotion",

  async resolve(keys) {
    const out = new Map<string, { id: string; hint: { slug: string; name: string }; expect: string }>();
    for (const key of keys) {
      const promo = promotionBySlug(key);
      if (!promo) continue;
      out.set(key, {
        id: promo.slug,
        hint: { slug: promo.slug, name: promo.name },
        expect: `@${promo.name}`,
      });
    }
    return out;
  },

  async hydrate(ids) {
    const out = new Map<string, { slug?: string; name?: string }>();
    for (const id of ids) {
      const promo = promotionBySlug(id);
      // An org dropped from the registry stops resolving, and the span degrades
      // to plain text rather than linking to a filter that matches nothing.
      if (!promo) continue;
      out.set(id, { slug: promo.slug, name: promo.name });
    }
    return out;
  },

  async preview(ids) {
    const known = ids
      .map((id) => promotionBySlug(id))
      .filter((p): p is NonNullable<typeof p> => Boolean(p));
    if (known.length === 0) return [];

    // ONE grouped count for the whole batch, never a count per promotion.
    const counts = await prisma.event.groupBy({
      by: ["promotionId"],
      where: { promotionId: { in: known.map((p) => p.slug) }, date: { gte: new Date() } },
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
  },
});
