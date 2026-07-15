import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { EVENTS } from "@/lib/data/fixtures";
import {
  getArticlesForEvent,
  getEvent,
  getSportById,
  getFightById,
  getFightsForEvent,
  getMarketsForEvent,
  getPostsForEvent,
  getPromotion,
  getPromptsForEvent,
  getSportBySlug,
  getAthlete,
  getResult,
  getVenue,
} from "@/lib/data/store";
import { getSportRules } from "@/lib/domain/sportRules";
import { EventHeader } from "@/components/event/EventHeader";
import { HeadlineMatchup } from "@/components/event/HeadlineMatchup";
import {
  EventSectionNavigation,
  type EventSection,
} from "@/components/event/EventSectionNavigation";
import { EventOverview } from "@/components/event/EventOverview";
import { FightCard } from "@/components/fightcard/FightCard";
import { CoverageFeed } from "@/components/coverage/CoverageFeed";
import { PredictionPanel } from "@/components/predictions/PredictionPanel";
import { EventDiscussion, type BoutOption } from "@/components/discussion/EventDiscussion";
import { ResultsPanel } from "@/components/results/ResultsPanel";

interface PageProps {
  params: Promise<{ sportSlug: string; eventSlug: string }>;
}

export function generateStaticParams() {
  return EVENTS.flatMap((event) => {
    const sport = getSportById(event.sportId);
    if (!sport) return [];
    return [{ sportSlug: sport.slug, eventSlug: event.slug }];
  });
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { sportSlug, eventSlug } = await params;
  const event = getEvent(sportSlug, eventSlug);
  return {
    title: event?.name ?? "Event",
    description: event?.description,
  };
}

/**
 * The canonical event destination. The ENTIRE event journey lives here —
 * overview, card, coverage, predictions, discussion and results — behind sticky
 * in-place navigation, so the user stays anchored to one event throughout.
 */
export default async function EventPage({ params }: PageProps) {
  const { sportSlug, eventSlug } = await params;
  const sport = getSportBySlug(sportSlug);
  const event = getEvent(sportSlug, eventSlug);
  if (!sport || !event) notFound();

  const rules = getSportRules(sport.slug);
  const promotion = getPromotion(event.promotionId);
  const venue = getVenue(event.venueId);
  const fights = getFightsForEvent(event.id);
  const articles = getArticlesForEvent(event.id);
  const posts = getPostsForEvent(event.id);
  const prompts = getPromptsForEvent(event.id);
  const markets = getMarketsForEvent(event.id);
  const headline = event.headlineFightId ? getFightById(event.headlineFightId) : undefined;

  const completedCount = fights.filter((f) => getResult(f.id)).length;

  const boutOptions: BoutOption[] = fights.map((f) => {
    const red = f.participants.find((p) => p.corner === "red");
    const blue = f.participants.find((p) => p.corner === "blue");
    const label =
      red && blue
        ? `${getAthlete(red.athleteId).name.split(" ").pop()} vs ${getAthlete(blue.athleteId).name.split(" ").pop()}`
        : f.weightClass;
    return { fightId: f.id, label };
  });

  const sections: EventSection[] = [
    {
      id: "overview",
      label: "Overview",
      node: (
        <EventOverview
          event={event}
          promotion={promotion}
          venue={venue}
          fights={fights}
          articles={articles}
        />
      ),
    },
    {
      id: "card",
      label: "Fight card",
      badge: fights.length,
      node: <FightCard fights={fights} rules={rules} sport={sport} eventSlug={event.slug} />,
    },
    {
      id: "coverage",
      label: "Coverage",
      badge: articles.length || undefined,
      node: <CoverageFeed articles={articles} fights={fights} />,
    },
    {
      id: "predictions",
      label: "Predictions",
      badge: markets.length || undefined,
      node: <PredictionPanel event={event} fights={fights} />,
    },
    {
      id: "discussion",
      label: "Discussion",
      badge: posts.length || undefined,
      node: (
        <EventDiscussion
          eventId={event.id}
          posts={posts}
          prompts={prompts}
          bouts={boutOptions}
          threadTitle={`${event.name} — event thread`}
        />
      ),
    },
    {
      id: "results",
      label: "Results",
      badge: completedCount || undefined,
      node: <ResultsPanel event={event} fights={fights} />,
    },
  ];

  // Live/completed events open on Overview but surface results prominently.
  const initialId = "overview";

  return (
    <>
      <EventHeader event={event} promotion={promotion} venue={venue} />
      {headline ? <HeadlineMatchup fight={headline} rules={rules} /> : null}
      <EventSectionNavigation sections={sections} initialId={initialId} />
    </>
  );
}
