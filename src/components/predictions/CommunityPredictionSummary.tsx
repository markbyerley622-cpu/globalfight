import { Flame, Scale, Users } from "lucide-react";
import type { CommunityPredictionSummary as Summary } from "@/lib/domain/predictionSummary";
import { getAthlete, getFightById } from "@/lib/data/store";

/**
 * Event-level prediction summary: how the community sees the card as a whole —
 * clearest favourite, closest call, most contested bout.
 */
export function CommunityPredictionSummary({ summary }: { summary: Summary }) {
  if (summary.boutsWithMarkets === 0) return null;

  const matchupLabel = (fightId?: string) => {
    if (!fightId) return "—";
    const fight = getFightById(fightId);
    if (!fight) return "—";
    const red = fight.participants.find((p) => p.corner === "red");
    const blue = fight.participants.find((p) => p.corner === "blue");
    if (!red || !blue) return "—";
    return `${getAthlete(red.athleteId).name.split(" ").pop()} vs ${getAthlete(blue.athleteId).name.split(" ").pop()}`;
  };

  return (
    <div className="rounded-xl border border-border bg-surface p-3.5">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-sm font-semibold">Community read</h3>
        <span className="inline-flex items-center gap-1 text-[11px] text-faint">
          <Users className="h-3 w-3" /> {summary.totalVotes.toLocaleString()} total picks
        </span>
      </div>
      <dl className="grid grid-cols-1 gap-2.5">
        <Stat
          icon={<Flame className="h-4 w-4 text-brand" />}
          label="Clearest favourite"
          value={matchupLabel(summary.strongestFavourite?.fightId)}
          detail={summary.strongestFavourite ? `${summary.strongestFavourite.favouritePct}% backing one side` : undefined}
        />
        <Stat
          icon={<Scale className="h-4 w-4 text-warning" />}
          label="Closest call"
          value={matchupLabel(summary.closest?.fightId)}
          detail={summary.closest ? `split by just ${summary.closest.margin} points` : undefined}
        />
        <Stat
          icon={<Users className="h-4 w-4 text-[var(--color-blue-corner)]" />}
          label="Most contested"
          value={matchupLabel(summary.biggestDisagreement?.fightId)}
          detail={
            summary.biggestDisagreement
              ? `${summary.biggestDisagreement.totalVotes.toLocaleString()} picks, near-even`
              : undefined
          }
        />
      </dl>
    </div>
  );
}

function Stat({
  icon,
  label,
  value,
  detail,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  detail?: string;
}) {
  return (
    <div className="flex items-center gap-2.5 rounded-lg bg-surface-2 px-3 py-2">
      <span className="shrink-0">{icon}</span>
      <div className="min-w-0 flex-1">
        <dt className="text-[11px] uppercase tracking-wide text-faint">{label}</dt>
        <dd className="truncate text-sm font-medium">{value}</dd>
      </div>
      {detail ? <span className="shrink-0 text-[11px] text-muted">{detail}</span> : null}
    </div>
  );
}
