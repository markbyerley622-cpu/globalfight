import "server-only";
import { prisma } from "@/lib/db";
import { registerEntitySource } from "./registry";
import { rankByMatch } from "./rank";

// ════════════════════════════════════════════════════════════════════════════
//  A GYM.
//
//  ── The key is the SLUG ───────────────────────────────────────────────────
//  Already public: it is the URL at /gyms/<slug>. The primary key never leaves
//  the server — the same invariant every other source keeps.
//
//  ── There is no such thing as a private gym ───────────────────────────────
//  Worth stating plainly, because "filter out the hidden ones" is the reflex
//  and there is nothing to filter. The Gym model has no status, no soft-delete
//  and no visibility flag: every row is a public page at /gyms/<slug>, and both
//  the /gyms directory and /api/search return them unfiltered.
//
//  `verified` is NOT a visibility gate. It is a quality signal that orders the
//  directory and decides whether a gym's own FEED is open for posting (see
//  lib/gym-posts/authorise). Treating it as one here would mean an unverified
//  gym could be read, followed, reviewed and linked from the map, but could not
//  be named in a sentence — which is not a policy anybody wrote down, and
//  inventing it in a typeahead would be the wrong place to start.
//
//  So suggestion and resolution apply the same filter the rest of the product
//  applies: none. If a visibility concept is ever introduced it belongs on the
//  model and in a shared predicate — the way PUBLIC_EVENT works for events —
//  and both methods below would then spread it.
//
//  Access-control walk (CLAUDE.md rules 1–8): public reads throughout, no
//  session required, nothing viewer-scoped, no writes. `memberCount` is the
//  denormalised column — who trains somewhere is not published here, only how
//  many do. A slug or id that does not exist is absent from the result rather
//  than an error, so none of these is an existence oracle.
// ════════════════════════════════════════════════════════════════════════════

/** Only ever project these — a typeahead has no business reading a whole row. */
const SUGGEST_SELECT = {
  slug: true, name: true, city: true, country: true,
  logoUrl: true, verified: true, disciplines: true,
} as const;

registerEntitySource({
  kind: "gym",

  async suggest(q, limit) {
    // No blind listing. An empty query would be a directory dump, and the
    // directory is a page.
    if (!q) return [];

    const rows = await prisma.gym.findMany({
      where: {
        OR: [
          { name: { contains: q, mode: "insensitive" } },
          { city: { contains: q, mode: "insensitive" } },
        ],
      },
      // The database's own cheap ordering — the same one /gyms uses — which
      // rankByMatch then re-orders by match quality while keeping this as the
      // tie-break. So among equally good textual matches, the verified and
      // busier gym wins.
      orderBy: [{ verified: "desc" }, { memberCount: "desc" }, { name: "asc" }],
      // Bounded over-fetch, then rank. Never a scan.
      take: limit * 4,
      select: SUGGEST_SELECT,
    });

    return rankByMatch(rows, q, limit, (g) => [g.name, g.city]).map((g) => ({
      kind: "gym",
      key: g.slug,
      // A gym inserts as its NAME — "@Sydney MMA", not "@sydney-mma", which is
      // a URL rather than something anybody writes in a sentence.
      insert: g.name,
      title: g.name,
      // Only what exists. A gym with no city and no disciplines gets no
      // subtitle rather than a placeholder.
      subtitle: [
        [g.city, g.country].filter(Boolean).join(", ") || null,
        g.disciplines.slice(0, 2).join(" · ") || null,
      ].filter(Boolean).join(" · ") || null,
      imageUrl: g.logoUrl,
      verified: g.verified,
    }));
  },

  async resolve(keys) {
    const rows = await prisma.gym.findMany({
      where: { slug: { in: keys } },
      select: { id: true, slug: true, name: true },
    });
    return new Map(
      rows.map((g) => [
        g.slug,
        { id: g.id, hint: { slug: g.slug, name: g.name }, expect: `@${g.name}` },
      ]),
    );
  },

  async hydrate(ids) {
    const rows = await prisma.gym.findMany({
      where: { id: { in: ids } },
      select: { id: true, slug: true, name: true },
    });
    return new Map(rows.map((g) => [g.id, { slug: g.slug, name: g.name }]));
  },

  async preview(ids) {
    const rows = await prisma.gym.findMany({
      where: { id: { in: ids } },
      select: {
        id: true, slug: true, name: true, logoUrl: true, verified: true,
        city: true, country: true, disciplines: true, memberCount: true,
        latitude: true, longitude: true, address: true,
      },
    });

    return rows.map((g) => ({
      kind: "gym",
      id: g.id,
      slug: g.slug,
      name: g.name,
      logoUrl: g.logoUrl,
      verified: g.verified,
      city: g.city,
      country: g.country,
      disciplines: g.disciplines,
      memberCount: g.memberCount,
      // Built server-side from coordinates we hold. A client assembling this
      // would need the raw lat/lon, which is more than a preview should ship
      // for a place whose position may be approximate.
      directionsUrl:
        g.latitude !== null && g.longitude !== null
          ? `https://www.google.com/maps/dir/?api=1&destination=${g.latitude},${g.longitude}`
          : g.address
            ? `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(`${g.name} ${g.address}`)}`
            : null,
    }));
  },
});
