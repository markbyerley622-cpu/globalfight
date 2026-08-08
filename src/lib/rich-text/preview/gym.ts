import "server-only";
import { prisma } from "@/lib/db";
import { registerPreviewLoader } from "./registry";

// ════════════════════════════════════════════════════════════════════════════
//  A GYM's preview.
//
//  Access-control walk: read-only and public — every field is already on
//  /gyms/<slug>. `memberCount` is the denormalised column, not a count of
//  member ROWS: who trains somewhere is not published by this endpoint, only
//  how many do.
// ════════════════════════════════════════════════════════════════════════════

registerPreviewLoader("gym", async (ids) => {
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
    // Built server-side from the coordinates we hold. A client that assembled
    // this would need the raw lat/lon, which is more than a preview should ship
    // for a place whose exact position may be approximate.
    directionsUrl:
      g.latitude !== null && g.longitude !== null
        ? `https://www.google.com/maps/dir/?api=1&destination=${g.latitude},${g.longitude}`
        : g.address
          ? `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(`${g.name} ${g.address}`)}`
          : null,
  }));
});
