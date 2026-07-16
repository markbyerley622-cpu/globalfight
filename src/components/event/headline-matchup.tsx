import Link from "next/link";
import { cn, formatRecord } from "@/lib/utils";
import type { Fight } from "@/lib/types";
import type { MarketProb } from "@/lib/market";
import { FighterAvatar } from "@/components/fighter-avatar";
import { Flag } from "@/components/flag";
import { Badge } from "@/components/ui/badge";
import { ProbabilityBar } from "@/components/probability-bar";

/**
 * The headline matchup: the reason the user opened the event. Symmetric red vs
 * blue framing with records, country, division and a title indicator — plus the
 * market-implied win probability when live lines are connected. Tapping opens
 * the full bout breakdown.
 */
export function HeadlineMatchup({ fight, market }: { fight: Fight; market: MarketProb | null }) {
  const { red, blue } = fight;

  return (
    <section className="border-b border-ink-700/70 px-4 py-5" aria-label="Headline matchup">
      <div className="mb-3 flex flex-wrap items-center justify-center gap-2">
        {fight.mainEvent && <Badge tone="red">Main event</Badge>}
        {fight.titleFight && <Badge tone="gold">Title fight</Badge>}
        {fight.weightClass && <Badge tone="neutral">{fight.weightClass}</Badge>}
        <Badge tone="neutral">{fight.scheduledRounds} × Round</Badge>
      </div>

      <div className="flex items-stretch gap-2">
        <Corner fighter={red} side="red" />
        <div className="flex flex-col items-center justify-center px-1">
          <span className="font-display text-lg font-black text-fog">VS</span>
        </div>
        <Corner fighter={blue} side="blue" alignEnd />
      </div>

      {market ? (
        <div className="mt-5">
          <div className="mb-1.5 flex items-center justify-between text-[0.65rem] uppercase tracking-wider text-fog">
            <span>Market implied probability</span>
            <span>{market.books} book{market.books === 1 ? "" : "s"}</span>
          </div>
          <ProbabilityBar redLabel={red.name} blueLabel={blue.name} redProbability={market.redP} />
        </div>
      ) : (
        <p className="mt-5 rounded-lg bg-ink-800 px-3 py-2 text-center text-xs text-fog">
          Awaiting live betting lines for this bout.
        </p>
      )}

      <Link
        href={`/predictions/${fight.slug}`}
        className="mt-4 flex items-center justify-center rounded-lg border border-ink-700 bg-ink-950/40 py-2.5 text-sm font-semibold text-chalk transition-colors hover:border-blood-500/40 hover:text-blood-300"
      >
        Full breakdown &amp; predictions
      </Link>
    </section>
  );
}

function Corner({ fighter, side, alignEnd }: { fighter: Fight["red"]; side: "red" | "blue"; alignEnd?: boolean }) {
  return (
    <div className={cn("flex flex-1 flex-col gap-2", alignEnd ? "items-end text-right" : "items-start text-left")}>
      <FighterAvatar fighter={fighter} size="lg" />
      <div className={cn(alignEnd && "flex flex-col items-end")}>
        <Link
          href={`/fighters/${fighter.slug}`}
          className="font-display text-base font-bold leading-tight text-chalk hover:text-blood-300"
        >
          {fighter.name}
        </Link>
        {fighter.nickname && <p className="text-xs text-mist">“{fighter.nickname}”</p>}
        <p className="mt-0.5 text-xs tabular-nums text-fog">
          {formatRecord(fighter.wins, fighter.losses, fighter.draws)}
        </p>
        {fighter.nationality && (
          <p className={cn("flex items-center gap-1 text-[11px] text-fog", alignEnd && "flex-row-reverse")}>
            <Flag code={fighter.countryCode} /> {fighter.nationality}
          </p>
        )}
      </div>
    </div>
  );
}
