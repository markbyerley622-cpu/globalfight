import { Trophy } from "lucide-react";
import type { Event, Fight } from "@/lib/domain/types";
import { methodLabel } from "@/lib/domain/sportRules";
import { getAthlete, getMarketForFight, getResult } from "@/lib/data/store";
import { splitFromMarket } from "@/lib/services/predictions";
import { groupFightsBySegment } from "@/lib/domain/selectors";
import { Badge } from "@/components/ui/Badge";
import { EmptyState } from "@/components/ui/EmptyState";

/**
 * Results section. Populated once bouts complete. Each row pairs the official
 * result with the community's prediction outcome (did the favourite deliver?).
 */
export function ResultsPanel({ event, fights }: { event: Event; fights: Fight[] }) {
  const completed = groupFightsBySegment(fights)
    .flatMap((s) => s.fights)
    .filter((f) => getResult(f.id));

  if (completed.length === 0) {
    return (
      <EmptyState
        icon={<Trophy className="h-6 w-6" />}
        title={event.status === "live" ? "Results coming in" : "No results yet"}
        description={
          event.status === "live"
            ? "Bouts are still in progress. Results appear here the moment each one is official."
            : "Results will be posted here once the event is under way."
        }
        tone="unavailable"
      />
    );
  }

  return (
    <div className="flex flex-col gap-2.5">
      {completed.map((fight) => (
        <ResultRow key={fight.id} fight={fight} />
      ))}
    </div>
  );
}

function ResultRow({ fight }: { fight: Fight }) {
  const result = getResult(fight.id)!;
  const red = fight.participants.find((p) => p.corner === "red")!;
  const blue = fight.participants.find((p) => p.corner === "blue")!;
  const redAthlete = getAthlete(red.athleteId);
  const blueAthlete = getAthlete(blue.athleteId);

  const winner =
    result.winnerCorner === "red" ? redAthlete : result.winnerCorner === "blue" ? blueAthlete : null;
  const loser =
    result.winnerCorner === "red" ? blueAthlete : result.winnerCorner === "blue" ? redAthlete : null;

  // Did the community favourite win?
  const market = getMarketForFight(fight.id);
  let favouriteOutcome: "hit" | "upset" | null = null;
  if (market && result.winnerCorner) {
    const { redPct } = splitFromMarket(market);
    const favouriteCorner = redPct >= 50 ? "red" : "blue";
    favouriteOutcome = favouriteCorner === result.winnerCorner ? "hit" : "upset";
  }

  return (
    <div className="rounded-xl border border-border bg-surface p-3">
      <div className="flex items-center justify-between gap-2">
        <Badge tone="outline">{fight.weightClass}</Badge>
        {favouriteOutcome === "upset" ? (
          <Badge tone="warning">Upset</Badge>
        ) : favouriteOutcome === "hit" ? (
          <Badge tone="success">Favourite delivered</Badge>
        ) : null}
      </div>
      <p className="mt-1.5 text-sm">
        {winner ? (
          <>
            <span className="font-semibold">{winner.name}</span>
            <span className="text-muted"> def. </span>
            <span>{loser?.name}</span>
          </>
        ) : (
          <span className="font-semibold">
            {redAthlete.name} drew {blueAthlete.name}
          </span>
        )}
      </p>
      <p className="mt-0.5 text-xs text-muted">
        {methodLabel(result.method)}
        {result.endRound ? ` · Round ${result.endRound}` : ""}
        {result.endTimeSec != null
          ? ` · ${Math.floor(result.endTimeSec / 60)}:${String(result.endTimeSec % 60).padStart(2, "0")}`
          : ""}
        {result.detail ? ` · ${result.detail}` : ""}
      </p>
    </div>
  );
}
