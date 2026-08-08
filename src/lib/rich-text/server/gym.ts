import "server-only";
import { prisma } from "@/lib/db";
import { registerEntitySource } from "./registry";

// ════════════════════════════════════════════════════════════════════════════
//  A GYM.
//
//  ── No `suggest`, on purpose ──────────────────────────────────────────────
//  A gym is storable, renderable, navigable and previewable — everything a
//  reference needs — but no composer offers one yet. That is a product
//  decision, not a missing implementation, and the registry expresses it
//  exactly: `suggest` is optional, so a kind without it simply never appears in
//  the picker while the rest of the pipeline works unchanged. Adding gyms to
//  the picker later is this one method and nothing else.
//
//  Access-control walk: public reads throughout, no session, no writes.
//  `memberCount` is the denormalised column — who trains somewhere is not
//  published here, only how many do.
// ════════════════════════════════════════════════════════════════════════════

registerEntitySource({
  kind: "gym",

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
