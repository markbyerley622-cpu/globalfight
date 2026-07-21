import { PlayCircle, Crown } from "lucide-react";
import type { Fight } from "@/lib/types";
import type { MarketProb } from "@/lib/market";
import { boutLabel, highlightsUrl, winningCorner } from "@/lib/event-format";
import { formatRecord, koPercentage } from "@/lib/utils";
import { FighterAvatar } from "@/components/fighter-avatar";
import { ProbabilityBar } from "@/components/probability-bar";

/**
 * One bout, one full-width row — the standardised fight-card unit used on both
 * the event page and the schedule so every combat sport reads identically.
 * Red corner · VS · Blue corner, with a meta strip (slot, division, rounds) and
 * a lifecycle-aware footer: win probability before the fight, a rich result
 * (method · round · time) and a highlights link after it.
 *
 * The row does NOT link anywhere: it is the masthead of the bout's own module
 * (see components/fight/fight-module), and the arena it used to link to is the
 * block directly beneath it.
 */
export function FightRow({
  fight,
  index,
  market,
}: {
  fight: Fight;
  index: number;
  market?: MarketProb | null;
}) {
  const { red, blue, result } = fight;
  const done = result !== "SCHEDULED";
  const won = winningCorner(fight);
  const redWon = won === "red";
  const blueWon = won === "blue";
  const redP = market?.redP ?? fight.prediction?.redProbability;

  return (
    <div className={`card-surface overflow-hidden ${fight.titleFight ? "ring-1 ring-gold-500/30" : ""}`}>
      {/* Championship bar — title fights read as premium without breaking layout. */}
      {fight.titleFight && <div className="h-0.5 bg-gradient-to-r from-gold-500/60 via-gold-400 to-gold-500/60" />}
      <div className="block">
        {/* Meta strip */}
        <div className="flex items-center justify-between gap-2 border-b border-ink-700/70 px-4 py-2 text-[11px]">
          <div className="flex min-w-0 items-center gap-2">
            <span className="shrink-0 font-display font-bold uppercase tracking-wide text-blood-400">
              {boutLabel(fight, index)}
            </span>
            {fight.titleFight && (
              <span className="inline-flex items-center gap-1 rounded bg-gold-500/15 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-gold-300">
                <Crown className="size-3" /> Title
              </span>
            )}
          </div>
          <div className="flex shrink-0 items-center gap-2 text-fog">
            {fight.weightClass && <span className="truncate">{fight.weightClass}</span>}
            <span aria-hidden>·</span>
            <span className="tabular-nums">{fight.scheduledRounds} rds</span>
          </div>
        </div>

        {/* Matchup — one line: red | VS | blue */}
        <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2 px-4 py-3.5">
          <Corner fighter={red} won={redWon} dim={done && !redWon} />
          <span className="px-1 font-display text-base font-black text-fog">VS</span>
          <Corner fighter={blue} won={blueWon} dim={done && !blueWon} alignEnd />
        </div>

        {/* Pre-fight: win probability */}
        {!done && redP != null && (
          <div className="border-t border-ink-700/70 px-4 py-2.5">
            <ProbabilityBar redLabel={red.name} blueLabel={blue.name} redProbability={redP} compact />
          </div>
        )}

        {/* Post-fight: rich result */}
        {done && (
          <div className="flex items-center justify-center gap-2 border-t border-ink-700/70 bg-ink-950/40 px-4 py-2.5 text-sm">
            {result === "WIN" && fight.method ? (
              <>
                <span className="rounded bg-blood-500/15 px-2 py-0.5 font-display text-xs font-bold uppercase tracking-wide text-blood-300">
                  {fight.method}
                </span>
                {fight.roundEnded && (
                  <span className="text-fog">
                    Round <span className="font-semibold text-chalk">{fight.roundEnded}</span>
                  </span>
                )}
                {fight.timeEnded && <span className="tabular-nums text-fog">· {fight.timeEnded}</span>}
              </>
            ) : (
              <span className="font-semibold text-mist">
                {result === "DRAW" ? "Draw" : result === "NO_CONTEST" ? "No contest" : "Decision"}
              </span>
            )}
          </div>
        )}
      </div>

      {/* Post-fight: highlights link */}
      {done && (
        <a
          href={highlightsUrl(fight)}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center justify-center gap-1.5 border-t border-ink-700/70 py-2 text-xs font-semibold text-blood-300 transition-colors hover:bg-blood-500/10"
        >
          <PlayCircle className="size-4" /> Watch highlights &amp; KO clips
        </a>
      )}
    </div>
  );
}

function Corner({
  fighter,
  won,
  dim,
  alignEnd,
}: {
  fighter: Fight["red"];
  won?: boolean;
  dim?: boolean;
  alignEnd?: boolean;
}) {
  // KO ratio from data already on the card (no extra query). A high finisher
  // rate is the card's "danger" tell, so surface it as a signal — tinted blood
  // when it's a real threat — rather than a faint afterthought.
  const ko = fighter.wins > 0 ? koPercentage(fighter.koWins, fighter.wins) : 0;
  return (
    <div className={`flex min-w-0 items-center gap-2.5 ${alignEnd ? "flex-row-reverse text-right" : "text-left"}`}>
      <FighterAvatar fighter={fighter} size="md" showFlag />
      <div className={`min-w-0 ${dim ? "opacity-60" : ""}`}>
        <p className="truncate font-display text-sm font-bold leading-tight text-chalk">
          {fighter.name}
          {won && <span className="ml-1 text-blood-400">✓</span>}
        </p>
        <p className="truncate text-xs tabular-nums text-mist">
          {formatRecord(fighter.wins, fighter.losses, fighter.draws)}
          {ko > 0 && (
            <span className={ko >= 60 ? "font-semibold text-blood-300" : "text-fog"}> · {ko}% KO</span>
          )}
        </p>
      </div>
    </div>
  );
}
