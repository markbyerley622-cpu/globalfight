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
    <section className="relative overflow-hidden border-b border-ink-700/70 px-4 py-7" aria-label="Headline matchup">
      {/* Subtle poster glow tinted by the promotion's brand colour (--accent). */}
      <div
        className="pointer-events-none absolute inset-x-0 top-0 h-40"
        style={{ background: "linear-gradient(to bottom, color-mix(in srgb, var(--accent, #e11d2a) 16%, transparent), transparent)" }}
        aria-hidden
      />

      <p
        className="mb-1 text-center font-display text-[0.7rem] font-bold uppercase tracking-[0.3em]"
        style={{ color: "var(--accent, #f2555f)" }}
      >
        {fight.mainEvent ? "Main Event" : "Featured Bout"}
      </p>
      <div className="mb-4 flex flex-wrap items-center justify-center gap-2">
        {fight.titleFight && <Badge tone="gold">Title fight</Badge>}
        {fight.weightClass && <Badge tone="neutral">{fight.weightClass}</Badge>}
        <Badge tone="neutral">{fight.scheduledRounds} × Round</Badge>
      </div>

      <div className="flex items-stretch gap-2">
        <Corner fighter={red} side="red" />
        <div className="flex flex-col items-center justify-center px-1">
          <span className="font-display text-2xl font-black text-fog sm:text-3xl">VS</span>
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
    </section>
  );
}

function Corner({ fighter, alignEnd }: { fighter: Fight["red"]; side: "red" | "blue"; alignEnd?: boolean }) {
  return (
    <div className={cn("flex flex-1 flex-col gap-2", alignEnd ? "items-end text-right" : "items-start text-left")}>
      <FighterAvatar fighter={fighter} size="lg" />
      <div className={cn(alignEnd && "flex flex-col items-end")}>
        <Link
          href={`/fighters/${fighter.slug}`}
          className="font-display text-lg font-bold leading-tight text-chalk hover:text-blood-300 sm:text-xl"
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
