import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import type { Fight } from "@/lib/domain/types";
import type { SportRules } from "@/lib/domain/sportRules";
import { methodLabel } from "@/lib/domain/sportRules";
import { getAthlete, getMarketForFight, getResult } from "@/lib/data/store";
import { splitFromMarket } from "@/lib/services/predictions";
import { formatRecord } from "@/lib/domain/format";
import { Badge } from "@/components/ui/Badge";
import { LiveDot } from "@/components/ui/LiveDot";

/**
 * One bout on the card. Adapts to bout status: prediction split when scheduled,
 * live marker when in progress, result when complete. Links to the optional
 * dedicated fight page.
 */
export function FightRow({
  fight,
  rules,
  href,
}: {
  fight: Fight;
  rules: SportRules;
  href?: string;
}) {
  const red = fight.participants.find((p) => p.corner === "red");
  const blue = fight.participants.find((p) => p.corner === "blue");
  if (!red || !blue) return null;

  const redAthlete = getAthlete(red.athleteId);
  const blueAthlete = getAthlete(blue.athleteId);
  const result = getResult(fight.id);
  const market = getMarketForFight(fight.id);
  const split = market ? splitFromMarket(market) : undefined;

  const redWon = result?.winnerCorner === "red";
  const blueWon = result?.winnerCorner === "blue";

  const body = (
    <div className="flex items-center gap-3 rounded-xl border border-border bg-surface p-3 transition-colors hover:border-brand/40">
      {/* Bout order */}
      <span className="w-5 shrink-0 text-center text-xs font-semibold tabular-nums text-faint">
        {fight.boutOrder}
      </span>

      <div className="min-w-0 flex-1">
        {/* Division + flags row */}
        <div className="mb-1.5 flex flex-wrap items-center gap-1.5">
          {fight.titleFight ? <Badge tone="warning">Title</Badge> : null}
          <Badge tone="outline">{fight.weightClass}</Badge>
          {fight.scheduledRounds ? (
            <span className="text-[10px] text-faint">
              {fight.scheduledRounds} × {rules.periodNoun ?? "rd"}
            </span>
          ) : null}
          {fight.status === "live" ? (
            <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-live">
              <LiveDot /> Live
            </span>
          ) : null}
        </div>

        {/* Competitors */}
        <Competitor
          name={redAthlete.name}
          record={formatRecord(redAthlete.record)}
          ranking={red.ranking}
          side="red"
          won={redWon}
          lost={result && !redWon && result.winnerCorner !== null}
        />
        <Competitor
          name={blueAthlete.name}
          record={formatRecord(blueAthlete.record)}
          ranking={blue.ranking}
          side="blue"
          won={blueWon}
          lost={result && !blueWon && result.winnerCorner !== null}
        />

        {/* Status line: result or prediction split */}
        {result ? (
          <p className="mt-1.5 text-[11px] text-muted">
            {result.winnerCorner ? methodLabel(result.method) : `Draw · ${methodLabel(result.method)}`}
            {result.endRound ? ` · R${result.endRound}` : ""}
            {result.detail ? ` · ${result.detail}` : ""}
          </p>
        ) : split ? (
          <PredictionBar redPct={split.redPct} bluePct={split.bluePct} votes={market?.totalVotes ?? 0} />
        ) : null}
      </div>

      {href ? <ChevronRight className="h-4 w-4 shrink-0 text-faint" /> : null}
    </div>
  );

  if (!href) return body;
  return (
    <Link href={href} className="block focus-visible:rounded-xl">
      {body}
    </Link>
  );
}

function Competitor({
  name,
  record,
  ranking,
  side,
  won,
  lost,
}: {
  name: string;
  record: string;
  ranking?: number;
  side: "red" | "blue";
  won?: boolean;
  lost?: boolean;
}) {
  const dot = side === "red" ? "bg-[var(--color-red-corner)]" : "bg-[var(--color-blue-corner)]";
  const rankLabel = ranking === 0 ? "C" : ranking ? `#${ranking}` : null;
  return (
    <div className="flex items-center gap-2 py-0.5">
      <span className={cn("h-2 w-2 shrink-0 rounded-full", dot)} aria-hidden />
      <span
        className={cn(
          "truncate text-sm",
          won && "font-semibold text-fg",
          lost && "text-faint line-through decoration-faint/60",
          !won && !lost && "text-fg",
        )}
      >
        {name}
      </span>
      {rankLabel ? <span className="text-[10px] text-faint">{rankLabel}</span> : null}
      {won ? <Badge tone="success" className="ml-1">W</Badge> : null}
      <span className="ml-auto text-[11px] tabular-nums text-faint">{record}</span>
    </div>
  );
}

function PredictionBar({ redPct, bluePct, votes }: { redPct: number; bluePct: number; votes: number }) {
  return (
    <div className="mt-2">
      <div className="flex h-1.5 overflow-hidden rounded-full bg-surface-2" aria-hidden>
        <div className="bg-[var(--color-red-corner)]" style={{ width: `${redPct}%` }} />
        <div className="bg-[var(--color-blue-corner)]" style={{ width: `${bluePct}%` }} />
      </div>
      <div className="mt-1 flex justify-between text-[10px] tabular-nums text-faint">
        <span>{redPct}%</span>
        <span>{votes.toLocaleString()} picks</span>
        <span>{bluePct}%</span>
      </div>
    </div>
  );
}
