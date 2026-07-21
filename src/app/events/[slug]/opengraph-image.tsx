import { prisma } from "@/lib/db";
import { resolvePromotion } from "@/lib/promotions";
import { renderOgCard, OG_SIZE, OG_CONTENT_TYPE } from "@/lib/og";

export const size = OG_SIZE;
export const contentType = OG_CONTENT_TYPE;
export const alt = "Combat Reviews event";

/** The share card leads with the MAIN EVENT, not the card's number — nobody
 *  clicks "ONE Fight Night 39", they click the two names. */
export default async function Image({ params }: { params: { slug: string } }) {
  const event = await prisma.event.findUnique({
    where: { slug: params.slug },
    select: {
      name: true, date: true, city: true, country: true, promotion: true, broadcaster: true,
      _count: { select: { fights: true } },
      fights: { where: { mainEvent: true }, take: 1, select: { red: { select: { name: true } }, blue: { select: { name: true } } } },
    },
  });

  if (!event) return renderOgCard({ eyebrow: "Event", headline: "Event not found" });

  const main = event.fights[0];
  const promo = resolvePromotion(event.promotion);
  const when = new Intl.DateTimeFormat("en-GB", { weekday: "short", day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }).format(event.date);

  return renderOgCard({
    eyebrow: promo.slug === "combat" ? "Fight card" : promo.name,
    headline: main ? `${main.red.name} vs ${main.blue.name}` : event.name,
    sub: main ? event.name : null,
    accent: promo.brand,
    chips: [
      when,
      `${event._count.fights} bout${event._count.fights === 1 ? "" : "s"}`,
      [event.city, event.country].filter(Boolean).join(", ") || null,
      event.broadcaster,
    ],
  });
}
