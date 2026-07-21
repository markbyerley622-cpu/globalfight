import { prisma } from "@/lib/db";
import { SITE } from "@/lib/config";
import { buildIcs, icsFilename } from "@/lib/calendar";
import { PUBLIC_EVENT } from "@/lib/events-visibility";

/**
 * The event as a downloadable .ics — the path Apple Calendar, Outlook desktop
 * and every other native client takes. Public and cacheable: an event's date is
 * the same for everyone, so this needs no session and should be served from the
 * edge cache rather than recomputed per download.
 */
export async function GET(_req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  // A draft is not published — it must not be exportable to a calendar either.
  const event = await prisma.event.findFirst({
    where: { slug, ...PUBLIC_EVENT },
    select: {
      id: true, slug: true, name: true, date: true, venue: true, city: true, country: true,
      broadcaster: true, _count: { select: { fights: true } },
    },
  });
  if (!event) return new Response("Event not found", { status: 404 });

  const url = `${SITE.url}/events/${event.slug}`;
  const details = [
    `${event._count.fights} bout${event._count.fights === 1 ? "" : "s"}.`,
    event.broadcaster ? `Watch: ${event.broadcaster}.` : null,
    `Card, predictions and discussion: ${url}`,
  ].filter(Boolean).join(" ");

  const ics = buildIcs({
    // Stable UID: re-adding the event updates the existing entry instead of
    // creating a duplicate in the user's calendar.
    uid: `event-${event.id}@combatreviews`,
    title: event.name,
    start: event.date,
    description: details,
    location: [event.venue, event.city, event.country].filter(Boolean).join(", ") || undefined,
    url,
  });

  return new Response(ics, {
    headers: {
      "content-type": "text/calendar; charset=utf-8",
      "content-disposition": `attachment; filename="${icsFilename(event.slug)}"`,
      "cache-control": "public, max-age=300, s-maxage=3600",
    },
  });
}
