import { FighterLink } from "@/components/fighter-link";
import { cn, formatRecord } from "@/lib/utils";
import type { Fight } from "@/lib/types";
import { FighterAvatar } from "@/components/fighter-avatar";
import { Flag } from "@/components/flag";
import { Badge } from "@/components/ui/badge";

/**
 * The headline matchup: the reason the user opened the event. Symmetric red vs
 * blue framing with records, country, division and a title indicator. Tapping
 * opens the full bout breakdown.
 *
 * Deliberately carries NO bookmaker line — see the note in the body.
 */
export function HeadlineMatchup({ fight }: { fight: Fight }) {
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
        className="mb-1 text-center font-display text-2xs font-bold uppercase tracking-[0.3em]"
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

      {/* ── Bookmaker odds removed from the event surface ──────────────────
          This used to render "Market implied probability · N books" plus the
          mandatory 18+/RG disclosure, and an "Awaiting live betting lines"
          placeholder when there was no market.

          Removing ONLY the disclosure was not an option: ingestion-registry.ts
          records The Odds API terms as "18+ / responsible-gambling messaging
          required wherever the data is displayed", so the notice and the data
          are a package — you drop both or neither.

          Dropping both is also the better product call. This is a prediction
          app, not a betting one; the community's own read belongs here, and a
          bookmaker line invites the comparison we do not want to host.

          The predictions surface still shows market data under its own
          disclosure; that is a separate, opted-into destination. */}
    </section>
  );
}

function Corner({ fighter, alignEnd }: { fighter: Fight["red"]; side: "red" | "blue"; alignEnd?: boolean }) {
  return (
    <div className={cn("flex flex-1 flex-col gap-2", alignEnd ? "items-end text-right" : "items-start text-left")}>
      <FighterAvatar fighter={fighter} size="lg" />
      <div className={cn(alignEnd && "flex flex-col items-end")}>
        <FighterLink
          name={fighter.name}
          slug={fighter.slug}
          className="font-display text-lg font-bold leading-tight text-chalk hover:text-blood-300 sm:text-xl"
        />
        {fighter.nickname && <p className="text-xs text-mist">“{fighter.nickname}”</p>}
        <p className="mt-0.5 text-xs tabular-nums text-fog">
          {formatRecord(fighter.wins, fighter.losses, fighter.draws)}
        </p>
        {fighter.nationality && (
          <p className={cn("flex items-center gap-1 text-[11px] text-fog", alignEnd && "flex-row-reverse")}>
            {/* nationality resolves only when it holds a country NAME ("Brazil"); a demonym
                ("Brazilian") is not mapped and still falls back to the placeholder. */}
            <Flag code={fighter.countryCode} name={fighter.nationality} /> {fighter.nationality}
          </p>
        )}
      </div>
    </div>
  );
}
