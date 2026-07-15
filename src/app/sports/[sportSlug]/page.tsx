import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getSports, getSportBySlug, getEventsBySport, eventCountsBySport } from "@/lib/data/store";
import { SportSwitcher } from "@/components/sport/SportSwitcher";
import { EventTimeline } from "@/components/events/EventTimeline";
import { Ticker } from "@/components/layout/Ticker";

interface PageProps {
  params: Promise<{ sportSlug: string }>;
}

/** Pre-render a page per supported sport — one shared system, no hardcoded pages. */
export function generateStaticParams() {
  return getSports().map((sport) => ({ sportSlug: sport.slug }));
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { sportSlug } = await params;
  const sport = getSportBySlug(sportSlug);
  return {
    title: sport ? `${sport.name} events` : "Events",
    description: sport ? `Upcoming, live and recent ${sport.name} events.` : undefined,
  };
}

/**
 * Sport event-discovery screen. A single reusable page rendered for every sport
 * via the `sportSlug` param — the sport selector just changes the param.
 */
export default async function SportPage({ params }: PageProps) {
  const { sportSlug } = await params;
  const sport = getSportBySlug(sportSlug);
  if (!sport) notFound();

  const events = getEventsBySport(sport.slug);
  const counts = eventCountsBySport();

  return (
    <>
      <SportSwitcher sports={getSports()} activeSlug={sport.slug} counts={counts} />
      <Ticker events={events} />
      <div className="px-4 py-5">
        <div className="mb-4">
          <h1 className="text-lg font-bold">{sport.name} events</h1>
          <p className="text-xs text-muted">
            Follow an event end to end — card, coverage, predictions and discussion in one place.
          </p>
        </div>
        <EventTimeline events={events} sportName={sport.name} />
      </div>
    </>
  );
}
