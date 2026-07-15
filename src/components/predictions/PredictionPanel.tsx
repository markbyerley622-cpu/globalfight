import { Vote } from "lucide-react";
import type { Event, Fight } from "@/lib/domain/types";
import { getAthlete, getMarketForFight, getMarketsForEvent, getResult } from "@/lib/data/store";
import { splitFromMarket } from "@/lib/services/predictions";
import { buildPredictionSummary } from "@/lib/domain/predictionSummary";
import { groupFightsBySegment } from "@/lib/domain/selectors";
import { EmptyState } from "@/components/ui/EmptyState";
import { BoutPredictionCard, type BoutPredictionData } from "./BoutPredictionCard";
import { CommunityPredictionSummary } from "./CommunityPredictionSummary";

/**
 * Predictions section: an event-level community summary followed by a
 * per-bout prediction control for every bout that has an open/settled market.
 */
export function PredictionPanel({ event, fights }: { event: Event; fights: Fight[] }) {
  const markets = getMarketsForEvent(event.id);

  if (markets.length === 0) {
    return (
      <EmptyState
        icon={<Vote className="h-6 w-6" />}
        title="Predictions not open yet"
        description="Bout-by-bout predictions open once the card is confirmed."
        tone="unavailable"
      />
    );
  }

  const summary = buildPredictionSummary(markets, fights);
  // Present bouts top-of-card first.
  const ordered = groupFightsBySegment(fights).flatMap((s) => s.fights);

  return (
    <div className="flex flex-col gap-4">
      <CommunityPredictionSummary summary={summary} />

      <div className="flex flex-col gap-2.5">
        <h3 className="eyebrow">Your predictions</h3>
        {ordered.map((fight) => {
          const data = toData(fight);
          if (!data) return null;
          return <BoutPredictionCard key={fight.id} data={data} />;
        })}
      </div>

      <p className="text-center text-[11px] text-faint">
        Predictions are free community picks — no odds, no wagering.
      </p>
    </div>
  );
}

function toData(fight: Fight): BoutPredictionData | null {
  const market = getMarketForFight(fight.id);
  if (!market) return null;
  const red = fight.participants.find((p) => p.corner === "red");
  const blue = fight.participants.find((p) => p.corner === "blue");
  if (!red || !blue) return null;
  const { redPct, bluePct } = splitFromMarket(market);
  const result = getResult(fight.id);
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
}
