import Link from "next/link";
import { Check, Flame, ArrowRight } from "lucide-react";
import type { JustHappenedEvent } from "@/lib/identity/just-happened";
import { methodLabel } from "@/components/forums/pick-identity";
import { timeAgo, cn } from "@/lib/utils";

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
  const finish = m ? [methodLabel(m.method), m.roundEnded ? `R${m.roundEnded}` : null].filter(Boolean).join(" · ") : null;
  const hard = m?.calledByPct != null && m.calledByPct <= 40;

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

        {m ? (
          <>
            <p className="mt-2 font-display text-base font-black leading-tight text-chalk">
              {m.winnerName} <span className="text-fog">def.</span> {m.loserName}
            </p>
            <p className="mt-0.5 text-xs text-mist">
              {finish || "Result in"}{m.titleFight ? <span className="text-gold-400"> · Title</span> : null}
            </p>
            {m.calledByPct != null && (
              <p className={cn("mt-2 inline-flex items-center rounded-md border px-2 py-0.5 text-[0.68rem] font-bold",
                hard ? "border-volt-500/35 bg-volt-500/10 text-volt-300" : "border-ink-700 bg-ink-800/60 text-fog")}>
                {hard ? `Only ${m.calledByPct}% called it` : `${m.calledByPct}% called it`}
              </p>
            )}
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
