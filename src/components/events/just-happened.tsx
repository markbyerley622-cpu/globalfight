import Link from "next/link";
import { Check, Flame, ArrowRight, Clock, Zap } from "lucide-react";
import type { JustHappenedEvent } from "@/lib/identity/just-happened";
import { timeAgo, cn } from "@/lib/utils";

// A finish method mapped to a scannable badge. Colour carries meaning at a
// glance: a stoppage reads hot, a submission volt, a decision cool. Every label
// is the real FightMethod — nothing invented.
const METHOD_BADGE: Record<string, { label: string; cls: string }> = {
  KO:  { label: "KO",  cls: "border-blood-500/40 bg-blood-500/15 text-blood-300" },
  TKO: { label: "TKO", cls: "border-blood-500/40 bg-blood-500/15 text-blood-300" },
  RTD: { label: "TKO", cls: "border-blood-500/40 bg-blood-500/15 text-blood-300" }, // corner stoppage
  SUB: { label: "SUB", cls: "border-volt-500/40 bg-volt-500/12 text-volt-300" },
  UD:  { label: "UD",  cls: "border-ink-600 bg-ink-800/70 text-mist" },
  MD:  { label: "MD",  cls: "border-ink-600 bg-ink-800/70 text-mist" },
  SD:  { label: "SD",  cls: "border-gold-500/40 bg-gold-500/12 text-gold-300" }, // split — dramatic
  TD:  { label: "TD",  cls: "border-ink-600 bg-ink-800/70 text-mist" },
  DQ:  { label: "DQ",  cls: "border-blood-500/40 bg-blood-500/12 text-blood-300" },
  NC:  { label: "NC",  cls: "border-ink-600 bg-ink-800/70 text-fog" },
  DRAW:{ label: "Draw",cls: "border-ink-600 bg-ink-800/70 text-fog" },
};

function Badge({ children, cls }: { children: React.ReactNode; cls: string }) {
  return <span className={cn("inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[0.62rem] font-black uppercase tracking-wide", cls)}>{children}</span>;
}

// ── Just Happened band ──────────────────────────────────────────────────────
// Sits above the upcoming list. Each card answers who won · how · how hard the
// call was · and — for a signed-in viewer — what it did to their record. The
// viewer delta is the payload: a completed card is evidence of what changed, not
// a headline. The whole card links to the existing event page (the full recap).

export function JustHappened({ events }: { events: JustHappenedEvent[] }) {
  if (events.length === 0) return null;
  return (
    <section aria-label="Just happened" className="space-y-3">
      <div className="flex items-baseline justify-between">
        <h2 className="font-display text-sm font-black uppercase tracking-[0.18em] text-chalk">Just happened</h2>
        <Link href="/events?status=completed" className="text-[0.7rem] font-semibold text-fog transition-colors hover:text-chalk">
          All results →
        </Link>
      </div>

      {/* Horizontal rail on mobile (data-hscroll: the shell must not treat a
          sideways scroll here as a section swipe), grid on wider screens. */}
      <div data-hscroll className="-mx-4 flex snap-x gap-3 overflow-x-auto px-4 pb-1 hide-scrollbar sm:mx-0 sm:grid sm:grid-cols-2 sm:overflow-visible sm:px-0 lg:grid-cols-3">
        {events.map((e) => <Card key={e.slug} e={e} />)}
      </div>
    </section>
  );
}

function Card({ e }: { e: JustHappenedEvent }) {
  const m = e.main;
  const method = m?.method ? METHOD_BADGE[m.method] : null;
  const roundTime = m?.roundEnded ? `R${m.roundEnded}${m.timeEnded ? ` · ${m.timeEnded}` : ""}` : null;

  return (
    <Link
      href={`/events/${e.slug}`}
      className="flex w-[15.5rem] shrink-0 snap-start flex-col overflow-hidden rounded-2xl border border-ink-800 bg-ink-900 transition-colors hover:border-ink-700 hover:bg-ink-850 sm:w-auto"
    >
      <div className="flex-1 p-4">
        <div className="flex items-center justify-between gap-2 text-[0.62rem] font-semibold uppercase tracking-[0.14em] text-fog">
          <span className="truncate">{e.promotion ?? "Result"}</span>
          <span className="shrink-0">{timeAgo(e.date)}</span>
        </div>

        {m && m.resolved ? (
          // Scannable: the WINNER dominates, the loser recedes, then a badge row
          // reads method · round · honours · upset at a glance. No prose to read.
          <>
            <p className="mt-2 font-display text-lg font-black leading-[1.05] text-chalk">{m.winnerName}</p>
            <p className="text-[0.72rem] leading-tight text-fog">
              <span className="uppercase tracking-wide">def.</span> {m.loserName}
            </p>
            <div className="mt-2 flex flex-wrap items-center gap-1.5">
              {method && <Badge cls={method.cls}>{method.label}</Badge>}
              {roundTime && <Badge cls="border-ink-600 bg-ink-800/70 text-mist">{roundTime}</Badge>}
              {m.titleFight && <Badge cls="border-gold-500/40 bg-gold-500/12 text-gold-300">Title</Badge>}
              {m.upset && <Badge cls="border-volt-500/40 bg-volt-500/12 text-volt-300"><Zap className="size-2.5" />Upset</Badge>}
              {(m.performanceBonus || m.fightOfTheNight) && (
                <Badge cls="border-gold-500/40 bg-gold-500/12 text-gold-300">{m.fightOfTheNight ? "FOTN" : "POTN"}</Badge>
              )}
            </div>
            {m.calledByPct != null && !m.upset && (
              <p className="mt-2 text-[0.68rem] font-semibold text-fog">{m.calledByPct}% of the room called it</p>
            )}
            {m.upset && (
              <p className="mt-2 text-[0.68rem] font-semibold text-volt-300">Only {m.calledByPct}% saw it coming</p>
            )}
          </>
        ) : m ? (
          // The card happened but results aren't in yet — show the matchup and be
          // honest about why. It fills in with the winner once the cron resolves.
          <>
            <p className="mt-2 font-display text-base font-black leading-tight text-chalk">
              {m.redName} <span className="text-fog">vs</span> {m.blueName}
            </p>
            <p className="mt-2 inline-flex items-center gap-1.5 rounded-md border border-ink-700 bg-ink-800/60 px-2 py-0.5 text-[0.68rem] font-bold text-fog">
              <Clock className="size-3" /> Result pending{m.titleFight ? <span className="text-gold-400"> · Title</span> : null}
            </p>
            <p className="mt-1.5 text-[0.66rem] text-fog">The card has passed — results aren&apos;t in yet.</p>
          </>
        ) : (
          <p className="mt-2 font-display text-base font-black text-chalk">{e.name}</p>
        )}
      </div>

      {/* Identity strip — what the card did to the viewer. The whole reason this
          surface exists; only rendered when there's a real delta to show. */}
      {e.viewer && e.viewer.graded > 0 ? (
        <div className={cn("flex items-center gap-2 border-t px-4 py-2.5 text-xs font-bold",
          e.viewer.correct > 0 ? "border-volt-500/25 bg-volt-500/[0.07] text-volt-300" : "border-ink-800 bg-ink-950/40 text-fog")}>
          {e.viewer.correct > 0 && <Check className="size-3.5 shrink-0" strokeWidth={3} />}
          <span className="flex-1">You went {e.viewer.correct}/{e.viewer.graded}</span>
          {e.viewer.repGained > 0 && (
            <span className="inline-flex items-center gap-1 text-gold-300"><Flame className="size-3" />+{e.viewer.repGained}</span>
          )}
        </div>
      ) : (
        <div className="flex items-center gap-1.5 border-t border-ink-800 bg-ink-950/40 px-4 py-2.5 text-[0.7rem] font-semibold text-fog">
          See how the room did <ArrowRight className="size-3.5" />
        </div>
      )}
    </Link>
  );
}
