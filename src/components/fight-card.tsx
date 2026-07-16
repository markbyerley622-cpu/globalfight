import Link from "next/link";
import type { Fight } from "@/lib/types";
import { FighterAvatar } from "./fighter-avatar";
import { Badge } from "./ui/badge";
import { ProbabilityBar } from "./probability-bar";
import { formatRecord } from "@/lib/utils";

// Versus card used on schedule, predictions, and event pages.
export function FightCard({ fight, showPrediction = true }: { fight: Fight; showPrediction?: boolean }) {
  const { red, blue, prediction, result, winnerId } = fight;
  const redWon = result === "WIN" && winnerId === red.slug;
  const blueWon = result === "WIN" && winnerId === blue.slug;

  return (
    <Link
      href={`/predictions/${fight.slug}`}
      className="group block card-surface overflow-hidden transition-all hover:border-blood-500/40 hover:shadow-glow-red"
    >
      <div className="flex items-center justify-between border-b border-ink-700 px-4 py-2">
        <div className="flex items-center gap-2">
          {fight.titleFight && <Badge tone="gold">Title</Badge>}
          {fight.weightClass && <span className="text-xs text-fog">{fight.weightClass}</span>}
        </div>
        <span className="text-xs text-fog">{fight.scheduledRounds} rounds</span>
      </div>

      <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2 p-4">
        {/* Red corner */}
        <div className="flex flex-col items-center gap-2 text-center">
          <FighterAvatar fighter={red} size="lg" showFlag />
          <div>
            <p className="font-display text-sm font-bold leading-tight text-chalk">{red.name}</p>
            <p className="text-xs text-fog">{formatRecord(red.wins, red.losses, red.draws)}</p>
          </div>
          {redWon && <Badge tone="red">Winner</Badge>}
        </div>

        {/* VS */}
        <div className="flex flex-col items-center gap-1 px-1">
          <span className="font-display text-lg font-black text-fog">VS</span>
          {result !== "SCHEDULED" && fight.method && (
            <span className="rounded bg-ink-700 px-1.5 py-0.5 text-[0.6rem] font-bold text-mist">
              {fight.method}{fight.roundEnded ? ` R${fight.roundEnded}` : ""}
            </span>
          )}
        </div>

        {/* Blue corner */}
        <div className="flex flex-col items-center gap-2 text-center">
          <FighterAvatar fighter={blue} size="lg" showFlag />
          <div>
            <p className="font-display text-sm font-bold leading-tight text-chalk">{blue.name}</p>
            <p className="text-xs text-fog">{formatRecord(blue.wins, blue.losses, blue.draws)}</p>
          </div>
          {blueWon && <Badge tone="volt">Winner</Badge>}
        </div>
      </div>

      {showPrediction && prediction && (
        <div className="border-t border-ink-700 px-4 py-3">
          <div className="mb-1 flex items-center justify-between text-[0.65rem] uppercase tracking-wider text-fog">
            <span>Win Probability</span>
            <span>{Math.round((prediction.confidence ?? 0.6) * 100)}% confidence</span>
          </div>
          <ProbabilityBar
            redLabel={red.name}
            blueLabel={blue.name}
            redProbability={prediction.redProbability}
            compact
          />
        </div>
      )}
    </Link>
  );
}
