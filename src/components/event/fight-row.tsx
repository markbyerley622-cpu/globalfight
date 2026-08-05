import { PlayCircle, Crown, Ban } from "lucide-react";
import { FighterLink } from "@/components/fighter-link";
import type { BoutProgress } from "@/lib/card-segments";
import { LocalTime } from "@/components/event/event-schedule";
import type { Fight } from "@/lib/types";
import type { MarketProb } from "@/lib/market";
import { boutLabel, highlightsUrl, winningCorner, HIGHLIGHTS_LABEL } from "@/lib/event-format";
import { getServerT } from "@/lib/i18n-server";
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
/**
 * ASYNC because the highlights CTA is translated at SSR rather than after
 * hydration — `getServerT` reads the request's `locale` cookie, and `cookies()`
 * is request-cached, so a fourteen-bout card resolves it once and not once per
 * row. Safe to be async here: the only consumer is the event page, a Server
 * Component, which passes this into FightModule's `header` slot exactly the way
 * it already passes BoutPrediction into `pick`.
 */
export async function FightRow({
  fight,
  index,
  market,
  estimatedAt,
  estimated,
  progress = "upcoming",
}: {
  fight: Fight;
  index: number;
  market?: MarketProb | null;
  /** ISO estimated walkout time, or null when there's nothing to anchor it to. */
  estimatedAt?: string | null;
  /** True when the walkout time was derived rather than supplied. */
  estimated?: boolean;
  progress?: BoutProgress;
}) {
  const { red, blue, result } = fight;
  const cancelled = progress === "cancelled";
  const isCurrent = progress === "current";
  const done = result !== "SCHEDULED";
  const won = winningCorner(fight);
  const redWon = won === "red";
  const blueWon = won === "blue";
  const redP = market?.redP ?? fight.prediction?.redProbability;
  // ONE string, ONE key. HIGHLIGHTS_LABEL is both the English copy and the
  // dictionary key it is looked up by (lib/i18n-dict keys on English), so there
  // is no second place a surface could disagree about the wording.
  const t = await getServerT();

  return (
    <div
      className={`card-surface overflow-hidden ${fight.titleFight ? "ring-1 ring-gold-500/30" : ""} ${
        isCurrent ? "ring-2 ring-blood-500/60" : ""
      } ${cancelled ? "opacity-60" : ""}`}
    >
      {/* Championship bar — title fights read as premium without breaking layout. */}
      {fight.titleFight && !cancelled && <div className="h-0.5 bg-gradient-to-r from-gold-500/60 via-gold-400 to-gold-500/60" />}
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
            {isCurrent && (
              <span className="inline-flex items-center gap-1 rounded bg-blood-500/20 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-blood-300">
                <span className="live-dot" aria-hidden /> In the cage
              </span>
            )}
            {cancelled && (
              <span className="inline-flex items-center gap-1 rounded bg-ink-800 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-fog">
                <Ban className="size-3" /> Cancelled
              </span>
            )}
          </div>
          <div className="flex shrink-0 items-center gap-2 text-fog">
            {/* Estimated walkout — the single most-asked question about a card. */}
            {!done && !cancelled && estimatedAt && (
              <>
                <span className="inline-flex items-center gap-1">
                  {estimated && <span className="text-[9px] uppercase tracking-wide">est.</span>}
                  <LocalTime iso={estimatedAt} className="font-semibold tabular-nums text-mist" />
                </span>
                <span aria-hidden>·</span>
              </>
            )}
            {fight.weightClass && <span className="truncate">{fight.weightClass}</span>}
            <span aria-hidden>·</span>
            <span className="tabular-nums">{fight.scheduledRounds} rds</span>
          </div>
        </div>

        {/* A scratched or reshuffled bout explains itself in place. */}
        {fight.cardNote && (
          <p className="border-b border-ink-700/70 bg-ink-950/40 px-4 py-1.5 text-[11px] text-gold-300">
            {fight.cardNote}
          </p>
        )}

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
          <PlayCircle className="size-4" /> {t(HIGHLIGHTS_LABEL)}
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
  // The fighter is the central object — the whole block links to their profile,
  // unless the corner is an unannounced opponent, which is not a person and has
  // no profile to link (FighterLink).
  return (
    <FighterLink
      name={fighter.name}
      slug={fighter.slug}
      className={`group/f flex min-w-0 items-center gap-2.5 rounded-lg outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blood-400 ${alignEnd ? "flex-row-reverse text-right" : "text-left"}`}
    >
      {/* The avatar carries the crown so the winner is identifiable from the
          artwork alone, at a glance, without reading the name row.

          BROADCAST WEIGHT. The crown was a 20px chip with a 12px glyph tucked
          against the avatar's corner — correct information, whispered. On a
          results page the single fact a reader is scanning for is WHO WON, and
          it was the quietest thing in the row: smaller than the method badge,
          smaller than the title ribbon, and carried mostly by a font-weight
          change on the name.
          It is now sized and lit like an ESPN/UFC lower third — a haloed gold
          medallion over a gold-ringed portrait, with the word WINNER spelled
          out beneath the name. `crown-pop` is the arrival; the ring and the
          halo are static, so nothing here depends on motion being allowed. */}
      <span className="relative shrink-0">
        <span
          className={
            won
              ? "block rounded-full ring-2 ring-gold-400 shadow-[0_0_0_4px_rgba(224,169,27,0.14),0_0_26px_-4px_rgba(224,169,27,0.75)]"
              : "block"
          }
        >
          <FighterAvatar fighter={fighter} size="md" showFlag />
        </span>
        {won && (
          <span
            // Gold, and the ONLY gold thing in the row besides a title bar — a
            // winner marker has to be unmistakable. It replaced a small blood-red
            // "✓" appended to the name, which read as a checkbox and was invisible
            // next to the losing corner's identical-weight name.
            className="cr-crown-pop absolute -right-1.5 -top-2.5 flex size-7 items-center justify-center rounded-full border-2 border-gold-300 bg-gradient-to-b from-gold-300 to-gold-500 text-ink-950 shadow-[0_3px_12px_-2px_rgba(0,0,0,0.95),0_0_18px_-2px_rgba(224,169,27,0.9)]"
            title="Winner"
          >
            <Crown className="size-4 fill-current" aria-hidden />
          </span>
        )}
      </span>
      <div className={`min-w-0 ${dim ? "opacity-60" : ""}`}>
        <p className={`truncate font-display leading-tight transition-colors group-hover/f:text-blood-300 ${won ? "text-base font-black text-white sm:text-[1.0625rem]" : "text-sm font-bold text-chalk"}`}>
          {fighter.name}
        </p>
        {won && (
          // Spelled out, not only crowned. Colour and an icon alone leave the
          // outcome unreadable to anyone with a gold/grey deficiency, and this
          // is the one fact the row exists to deliver on a completed bout.
          <span
            className={`mt-0.5 inline-flex items-center gap-1 rounded-sm bg-gold-400 px-1.5 py-px font-display text-4xs font-black uppercase tracking-[0.14em] text-ink-950 ${alignEnd ? "flex-row-reverse" : ""}`}
          >
            Winner
          </span>
        )}
        <p className="truncate text-xs tabular-nums text-mist">
          {formatRecord(fighter.wins, fighter.losses, fighter.draws)}
          {ko > 0 && (
            <span className={ko >= 60 ? "font-semibold text-blood-300" : "text-fog"}> · {ko}% KO</span>
          )}
        </p>
      </div>
    </FighterLink>
  );
}
