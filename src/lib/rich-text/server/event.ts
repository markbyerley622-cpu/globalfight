import "server-only";
import { prisma } from "@/lib/db";
import { PUBLIC_EVENT } from "@/lib/events-visibility";
import { resolvePromotion } from "@/lib/promotions";
import { registerEntitySource } from "./registry";

// ════════════════════════════════════════════════════════════════════════════
//  An EVENT — a card, on a date, at a venue.
//
//  ── Draft events are invisible here, structurally ─────────────────────────
//  `PUBLIC_EVENT` is spread into EVERY query below, including `resolve`. That
//  last one matters more than it looks: without it, a promoter assembling a
//  card could be offered nothing by the picker and yet still store a reference
//  to a draft by posting its slug directly — and the entity would then render,
//  link and preview for everyone. The picker filtering alone would have been a
//  UI-level control over a server-level fact.
//
//  ── Upcoming beats historical ─────────────────────────────────────────────
//  Two bounded queries rather than one clever ordering: the future, ascending
//  (the nearest card first), then the past, descending, only if there is room
//  left. Somebody typing "UFC 3" while UFC 322 is next week means that one, not
//  UFC 3 from 1994 — and a single `orderBy date` in either direction gets that
//  exactly backwards for half of all queries.
//
//  ── Access-control walk (CLAUDE.md rules 1–8) ─────────────────────────────
//  Public reads, no session required, nothing viewer-scoped, no writes. A slug
//  or id that is a draft, or does not exist, is absent from the result in the
//  same way — so none of these can be used to test whether a draft exists.
// ════════════════════════════════════════════════════════════════════════════

const SUGGEST_SELECT = {
  slug: true, name: true, date: true, venue: true, city: true,
  promotion: true, posterUrl: true,
} as const;

const DATE_FMT = new Intl.DateTimeFormat("en-GB", {
  day: "numeric", month: "short", year: "numeric",
});

/** The promotion's canonical name, or the raw string when it is not a known org. */
function promotionLabel(raw: string | null): string | null {
  if (!raw) return null;
  const promo = resolvePromotion(raw);
  // "combat" is the registry's neutral fallback — a real hit never returns it.
  return promo.slug === "combat" ? raw : promo.name;
}

registerEntitySource({
  kind: "event",

  async suggest(q, limit) {
    if (!q) return [];

    const now = new Date();
    const match = {
      ...PUBLIC_EVENT,
      name: { contains: q, mode: "insensitive" as const },
    };

    const upcoming = await prisma.event.findMany({
      where: { ...match, date: { gte: now } },
      orderBy: { date: "asc" },
      take: limit,
      select: SUGGEST_SELECT,
    });

    // Only reach into history if the future did not fill the list.
    const past = upcoming.length >= limit
      ? []
      : await prisma.event.findMany({
          where: { ...match, date: { lt: now } },
          orderBy: { date: "desc" },
          take: limit - upcoming.length,
          select: SUGGEST_SELECT,
        });

    return [...upcoming, ...past].map((e) => ({
      kind: "event",
      key: e.slug,
      insert: e.name,
      title: e.name,
      subtitle: [
        promotionLabel(e.promotion),
        DATE_FMT.format(e.date),
        e.venue ?? e.city,
      ].filter(Boolean).join(" · "),
      imageUrl: e.posterUrl,
    }));
  },

  async resolve(keys) {
    const rows = await prisma.event.findMany({
      // PUBLIC_EVENT here too — see the header. A draft must not be referable
      // even by somebody who knows its slug.
      where: { ...PUBLIC_EVENT, slug: { in: keys } },
      select: { id: true, slug: true, name: true },
    });
    return new Map(
      rows.map((e) => [
        e.slug,
        { id: e.id, hint: { slug: e.slug, name: e.name }, expect: `@${e.name}` },
      ]),
    );
  },

  async hydrate(ids) {
    const rows = await prisma.event.findMany({
      // An event that becomes a draft AFTER being referenced stops resolving,
      // so the span degrades to plain text rather than linking into a card that
      // is no longer published.
      where: { ...PUBLIC_EVENT, id: { in: ids } },
      select: { id: true, slug: true, name: true },
    });
    return new Map(rows.map((e) => [e.id, { slug: e.slug, name: e.name }]));
  },

  async preview(ids) {
    const [events, mains] = await Promise.all([
      prisma.event.findMany({
        where: { ...PUBLIC_EVENT, id: { in: ids } },
        select: {
          id: true, slug: true, name: true, date: true, promotion: true,
          venue: true, city: true, country: true, posterUrl: true,
          _count: { select: { followers: true } },
        },
      }),
      // The headline bout cannot come from an `include` without pulling every
      // fight on every event in the batch. One narrow query instead.
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
      return {
        kind: "event",
        id: e.id,
        slug: e.slug,
        name: e.name,
        date: e.date.toISOString(),
        promotion: promotionLabel(e.promotion),
        venue: e.venue,
        city: e.city,
        posterUrl: e.posterUrl,
        followers: e._count.followers,
        // Picks are counted per FIGHT; summing them for a batch of events is a
        // group-by on a hover path. Left null — PreviewStats drops a null cell
        // rather than printing a misleading zero.
        predictions: null,
        mainEvent: main?.red && main.blue ? { red: main.red.name, blue: main.blue.name } : null,
        directionsUrl: e.venue
          ? `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(
              [e.venue, e.city, e.country].filter(Boolean).join(" "),
            )}`
          : null,
      };
    });
  },
});
