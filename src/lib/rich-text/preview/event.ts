import "server-only";
import { prisma } from "@/lib/db";
import { resolvePromotion } from "@/lib/promotions";
import { registerPreviewLoader } from "./registry";

// ════════════════════════════════════════════════════════════════════════════
//  An EVENT's preview.
//
//  Access-control walk: read-only and public. The main-event bout and the
//  follower count are both already on /events/<slug>.
//
//  ── One query for the card, one for the headline bout ─────────────────────
//  The bout cannot come from an `include` without pulling every fight on every
//  event in the batch. So the main events are fetched as a second, narrow query
//  filtered to `mainEvent: true` — two round trips for a batch of any size,
//  rather than a card's worth of undercard per event.
// ════════════════════════════════════════════════════════════════════════════

registerPreviewLoader("event", async (ids) => {
  const [events, mains] = await Promise.all([
    prisma.event.findMany({
      where: { id: { in: ids } },
      select: {
        id: true, slug: true, name: true, date: true, promotion: true,
        venue: true, city: true, country: true, posterUrl: true,
        _count: { select: { followers: true } },
      },
    }),
    prisma.fight.findMany({
      where: { eventId: { in: ids }, mainEvent: true },
      select: {
        eventId: true,
        red: { select: { name: true } },
        blue: { select: { name: true } },
      },
    }),
  ]);

  const mainByEvent = new Map(mains.map((f) => [f.eventId, f]));

  return events.map((e) => {
    const main = mainByEvent.get(e.id);
    // Through the in-code registry, so the name shown here is the same one the
    // rest of the product uses for that org rather than the raw ingest string.
    const promo = e.promotion ? resolvePromotion(e.promotion) : null;

    return {
      kind: "event",
      id: e.id,
      slug: e.slug,
      name: e.name,
      date: e.date.toISOString(),
      promotion: promo && promo.slug !== "combat" ? promo.name : e.promotion,
      venue: e.venue,
      city: e.city,
      posterUrl: e.posterUrl,
      followers: e._count.followers,
      // Predictions are counted per FIGHT, not per event, and summing them for
      // a batch of events is a group-by over the pick table on a hover path.
      // Left null rather than paid for here; the event page shows the real
      // number, and PreviewStats drops a null cell instead of printing a zero.
      predictions: null,
      mainEvent: main?.red && main.blue ? { red: main.red.name, blue: main.blue.name } : null,
      directionsUrl: e.venue
        ? `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(
            [e.venue, e.city, e.country].filter(Boolean).join(" "),
          )}`
        : null,
    };
  });
});
