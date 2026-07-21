import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { EventEditor, type EditableEvent } from "@/components/admin/event-editor";
import { FightCardEditor, type EditableFight, type Segment } from "@/components/admin/fight-card-editor";

export const dynamic = "force-dynamic";

/**
 * The whole editor in TWO queries: the event with its card, and the weight
 * classes for that sport. An 18-bout card costs the same as a 1-bout card.
 */
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
      fights: {
        orderBy: { orderOnCard: "asc" },
        select: {
          id: true, updatedAt: true, lockedFields: true,
          redId: true, blueId: true, weightClassId: true, scheduledRounds: true,
          titleFight: true, interimTitle: true, mainEvent: true, coMain: true,
          cardSegment: true, cancelled: true, cardNote: true, estimatedStartAt: true,
          result: true, winnerId: true, method: true, roundEnded: true, timeEnded: true,
          performanceBonus: true, fightOfTheNight: true,
          red: { select: { name: true } },
          blue: { select: { name: true } },
        },
      },
    },
  });
  if (!e) notFound();

  const weightClasses = await prisma.weightClass.findMany({
    where: { sport: e.sport },
    orderBy: { order: "asc" },
    select: { id: true, name: true },
  });

  const initial: EditableEvent = {
    id: e.id, slug: e.slug, name: e.name, sport: e.sport, status: e.status,
    promotion: e.promotion, venue: e.venue, city: e.city, country: e.country,
    countryCode: e.countryCode, broadcaster: e.broadcaster,
    posterUrl: e.posterUrl, heroUrl: e.heroUrl, description: e.description,
    timezone: e.timezone, eventUrl: e.eventUrl, ticketUrl: e.ticketUrl,
    date: e.date.toISOString(),
    broadcastStartAt: e.broadcastStartAt?.toISOString() ?? null,
    prelimStartAt: e.prelimStartAt?.toISOString() ?? null,
    mainCardStartAt: e.mainCardStartAt?.toISOString() ?? null,
    lockedFields: e.lockedFields,
    updatedAt: e.updatedAt.toISOString(),
    boutCount: e.fights.length,
  };

  // A fight with no segment yet falls into EARLY_PRELIM rather than vanishing;
  // the operator drags it where it belongs and that choice is then locked.
  const fights: EditableFight[] = e.fights.map((f) => ({
    id: f.id, updatedAt: f.updatedAt.toISOString(), lockedFields: f.lockedFields,
    redId: f.redId, redName: f.red.name, blueId: f.blueId, blueName: f.blue.name,
    weightClassId: f.weightClassId, scheduledRounds: f.scheduledRounds,
    titleFight: f.titleFight, interimTitle: f.interimTitle,
    mainEvent: f.mainEvent, coMain: f.coMain,
    cardSegment: (f.cardSegment as Segment) ?? "EARLY_PRELIM",
    cancelled: f.cancelled, cardNote: f.cardNote,
    estimatedStartAt: f.estimatedStartAt?.toISOString() ?? null,
    result: f.result, winnerId: f.winnerId, method: f.method,
    roundEnded: f.roundEnded, timeEnded: f.timeEnded,
    performanceBonus: f.performanceBonus, fightOfTheNight: f.fightOfTheNight,
  }));

  return (
    <EventEditor
      initial={initial}
      card={<FightCardEditor eventId={e.id} initial={fights} weightClasses={weightClasses} />}
    />
  );
}
