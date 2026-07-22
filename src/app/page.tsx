import type { Metadata } from "next";
import { getUpcomingEvents } from "@/lib/repo";
import { SPORT_BY_SLUG } from "@/lib/sports";
import { EventTimeline } from "@/components/events/event-timeline";
import { SITE } from "@/lib/config";

export const metadata: Metadata = {
  // Spelled out rather than relying on the root layout's title template:
  // Next applies that template to CHILD segments only, and this page shares the
  // root segment with the layout that defines it — so the homepage tab was the
  // one place in the app carrying no brand at all.
  title: `Events · ${SITE.name}`,
  description:
    "Every combat-sports event — MMA, boxing, Muay Thai, kickboxing, BJJ and more. Follow a card end to end: matchups, predictions and community in one place.",
  alternates: { canonical: "/" },
};

// Reads the registry at runtime (never statically prerendered).
export const dynamic = "force-dynamic";

export default async function HomePage({ searchParams }: { searchParams: Promise<{ sport?: string }> }) {
  const { sport } = await searchParams;
  const entry = sport ? SPORT_BY_SLUG[sport] : undefined;
  const sportName = entry?.label ?? "All";

  const all = await getUpcomingEvents();
  const events = entry ? all.filter((e) => e.sport === entry.value) : all;

  return (
    <div className="container-cr px-4 py-5">
      <div className="mb-4">
        <h1 className="font-display text-lg font-bold text-chalk">
          {sportName === "All" ? "All events" : `${sportName} events`}
        </h1>
        <p className="text-xs text-fog">
          Follow an event end to end — card, matchups, predictions and discussion in one place.
        </p>
      </div>
      <EventTimeline events={events} sportName={sportName} />
    </div>
  );
}
