import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeft } from "lucide-react";
import {
  getArticlesForEvent,
  getEvent,
  getFight,
  getMarketForFight,
  getPostsForEvent,
  getPromptsForEvent,
  getResult,
  getSportBySlug,
  getAthlete,
} from "@/lib/data/store";
import { getSportRules } from "@/lib/domain/sportRules";
import { splitFromMarket } from "@/lib/services/predictions";
import { HeadlineMatchup } from "@/components/event/HeadlineMatchup";
import { BoutPredictionCard } from "@/components/predictions/BoutPredictionCard";
import { CoverageFeed } from "@/components/coverage/CoverageFeed";
import { EventDiscussion, type BoutOption } from "@/components/discussion/EventDiscussion";
import { ResultsPanel } from "@/components/results/ResultsPanel";

interface PageProps {
  params: Promise<{ sportSlug: string; eventSlug: string; fightSlug: string }>;
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { sportSlug, eventSlug, fightSlug } = await params;
  const event = getEvent(sportSlug, eventSlug);
  const fight = event ? getFight(event.id, fightSlug) : undefined;
  if (!fight) return { title: "Bout" };
  const names = fight.participants.map((p) => getAthlete(p.athleteId).name.split(" ").pop());
  return { title: `${names.join(" vs ")} · ${event?.name}` };
}

/**
 * Optional deeper detail for a single bout. Reuses the shared matchup,
 * prediction and (bout-scoped) coverage/discussion components — no bespoke
 * per-sport duplication.
 */
export default async function FightPage({ params }: PageProps) {
  const { sportSlug, eventSlug, fightSlug } = await params;
  const sport = getSportBySlug(sportSlug);
  const event = getEvent(sportSlug, eventSlug);
  const fight = event ? getFight(event.id, fightSlug) : undefined;
  if (!sport || !event || !fight) notFound();

  const rules = getSportRules(sport.slug);
  const red = fight.participants.find((p) => p.corner === "red");
  const blue = fight.participants.find((p) => p.corner === "blue");
  const market = getMarketForFight(fight.id);
  const result = getResult(fight.id);

  const boutCoverage = getArticlesForEvent(event.id).filter((a) => a.fightId === fight.id);
  const boutPosts = getPostsForEvent(event.id).filter((p) => p.fightId === fight.id);
  const prompts = getPromptsForEvent(event.id).filter((p) => !p.fightId || p.fightId === fight.id);
  const boutOptions: BoutOption[] = red && blue
    ? [{ fightId: fight.id, label: `${getAthlete(red.athleteId).name.split(" ").pop()} vs ${getAthlete(blue.athleteId).name.split(" ").pop()}` }]
    : [];

  const predictionData =
    market && red && blue
      ? (() => {
          const { redPct, bluePct } = splitFromMarket(market);
          return {
            fightId: fight.id,
            redName: getAthlete(red.athleteId).name,
            blueName: getAthlete(blue.athleteId).name,
            redPct,
            bluePct,
            totalVotes: market.totalVotes,
            locked: market.status !== "open",
            winnerCorner: result?.winnerCorner ?? null,
            weightClass: fight.weightClass,
            titleFight: fight.titleFight,
          };
        })()
      : null;

  return (
    <div className="px-4 py-4">
      <Link
        href={`/sports/${sport.slug}/events/${event.slug}`}
        className="mb-2 inline-flex items-center gap-1 text-xs font-medium text-muted hover:text-fg"
      >
        <ChevronLeft className="h-4 w-4" /> {event.name}
      </Link>

      <HeadlineMatchup fight={fight} rules={rules} />

      <div className="flex flex-col gap-6">
        {result ? (
          <section aria-label="Result">
            <h2 className="mb-2 eyebrow">Result</h2>
            <ResultsPanel event={event} fights={[fight]} />
          </section>
        ) : null}

        {predictionData ? (
          <section aria-label="Prediction">
            <h2 className="mb-2 eyebrow">Prediction</h2>
            <BoutPredictionCard data={predictionData} />
          </section>
        ) : null}

        <section aria-label="Bout coverage">
          <h2 className="mb-2 eyebrow">Coverage</h2>
          <CoverageFeed articles={boutCoverage} fights={[fight]} />
        </section>

        <section aria-label="Bout discussion">
          <EventDiscussion
            eventId={event.id}
            posts={boutPosts}
            prompts={prompts}
            bouts={boutOptions}
            threadTitle="Bout discussion"
          />
        </section>
      </div>
    </div>
  );
}
