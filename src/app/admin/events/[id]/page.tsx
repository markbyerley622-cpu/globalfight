import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { EventEditor, type EditableEvent } from "@/components/admin/event-editor";

export const dynamic = "force-dynamic";

/** One query for the whole editor. Access is already enforced by the admin
 *  layout, so this page does not repeat the role check. */
export default async function AdminEventPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const e = await prisma.event.findUnique({
    where: { id },
    select: {
      id: true, slug: true, name: true, sport: true, status: true, promotion: true,
      venue: true, city: true, country: true, countryCode: true, broadcaster: true,
      posterUrl: true, heroUrl: true, description: true, timezone: true,
      eventUrl: true, ticketUrl: true, date: true,
      broadcastStartAt: true, prelimStartAt: true, mainCardStartAt: true,
      lockedFields: true, updatedAt: true,
      _count: { select: { fights: true } },
    },
  });
  if (!e) notFound();

  const initial: EditableEvent = {
    ...e,
    date: e.date.toISOString(),
    broadcastStartAt: e.broadcastStartAt?.toISOString() ?? null,
    prelimStartAt: e.prelimStartAt?.toISOString() ?? null,
    mainCardStartAt: e.mainCardStartAt?.toISOString() ?? null,
    updatedAt: e.updatedAt.toISOString(),
    boutCount: e._count.fights,
  };

  return <EventEditor initial={initial} />;
}
