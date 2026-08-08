import "server-only";
import { prisma } from "@/lib/db";
import { PROMOTIONS, promotionBySlug } from "@/lib/promotions";
import { registerEntitySource } from "./registry";
import { rankByMatch } from "./rank";

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

  /**
   * The only suggester that touches no database at all.
   *
   * Identity lives in the in-code registry, so this is a filter over a
   * few dozen objects already in memory. That is worth saying out loud because
   * the obvious alternative — deriving promotions from DISTINCT Event.promotion
   * — would be an unbounded group-by on a keystroke path, and would surface the
   * raw ingest strings ("UFC Fight Night", "ONE Friday Fights 163") as though
   * they were organisations.
   *
   * ALIASES are matched as well as names, which is the point of the registry:
   * somebody typing "ultimate fighting" or "onefc" finds the org they mean.
   * They are matched but never DISPLAYED — the canonical name is what gets
   * inserted, so the stored span is stable whichever alias was typed.
   */
  async suggest(q, limit) {
    if (!q) return [];
    const ql = q.toLowerCase();

    const matches = PROMOTIONS.filter((p) =>
      p.name.toLowerCase().includes(ql) ||
      p.mark.toLowerCase().includes(ql) ||
      p.aliases.some((a) => a.includes(ql)),
    );

    return rankByMatch(matches, q, limit, (p) => [p.name, p.mark, ...p.aliases]).map((p) => ({
      kind: "promotion",
      key: p.slug,
      insert: p.name,
      title: p.name,
      // The monogram, only when it says something the name does not — "UFC"
      // under the title "UFC" is noise.
      subtitle: p.mark.toLowerCase() === p.name.toLowerCase() ? null : p.mark,
      imageUrl: p.logo ?? null,
    }));
  },

  async resolve(keys) {
    const out = new Map<string, { id: string; hint: { slug: string; name: string }; expect: string }>();
    for (const key of keys) {
      // The REGISTRY is the visibility policy: `promotionBySlug` is a lookup in
      // PROMOTIONS, and the neutral fallback ("combat" / "Multiple promotions")
      // is deliberately declared outside that array. So the placeholder we
      // synthesise for events whose source names no org can be neither
      // suggested nor resolved — it is not an organisation, and letting one be
      // referenced would put "Multiple promotions" in front of a reader as
      // though it were one.
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
