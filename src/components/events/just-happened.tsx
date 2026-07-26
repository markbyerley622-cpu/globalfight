import Link from "next/link";
import { Check, Flame, ArrowRight, Zap, Swords, Hourglass } from "lucide-react";
import type { JustHappenedEvent } from "@/lib/identity/just-happened";
import { SportPosterArt } from "@/components/events/sport-poster-art";
import { PromotionLogo } from "@/components/promotion-logo";
import { resolvePromotion } from "@/lib/promotions";
import { sportAccent } from "@/lib/event-card-image";
import { SPORT_LABEL } from "@/lib/sports";
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
//
// It is BUILT LIKE AN EVENT CARD, deliberately: the same designed poster backdrop
// (sport-tinted, slug-seeded), the same promotion mark, the same sport tag in the
// same corner. A result is not a different species of object from a fixture, and
// two different-looking card systems on one page read as two half-finished
// products. What changes is the payload in the artwork: an upcoming card puts the
// matchup there, a finished one puts the WINNER there.

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

  // Same identity rules as the event card: a real promotion keeps its brand
  // colour, an unattributed card ("Various") takes the SPORT's signature colour
  // and shows no org mark — we never advertise a placeholder as an organisation.
  const promo = resolvePromotion(e.promotion);
  const hasRealPromo = promo.slug !== "combat";
  const accent = hasRealPromo ? promo.brand : sportAccent(e.sport);
  const sportLabel = SPORT_LABEL[e.sport] ?? "Combat";
  const resolved = !!m?.resolved;

  // flex-col + a flex-1 body: the identity strip pins to the BOTTOM, so cards in a
  // row share one baseline however much the bodies differ (a pending card has no
  // badge row, a finished one has four).
  return (
    <Link
      href={`/events/${e.slug}`}
      className="card-surface group relative flex w-[16.5rem] shrink-0 snap-start flex-col overflow-hidden transition-colors hover:border-blood-500/40 sm:w-auto"
      style={{ "--accent": accent } as React.CSSProperties}
    >
      {/* The artwork region — where the RESULT lives. */}
      <div className="relative h-28 shrink-0 overflow-hidden sm:h-32">
        <div className="relative size-full overflow-hidden">
          <SportPosterArt seed={e.slug} sportValue={e.sport} label={sportLabel} idKey="-jh" />
          {hasRealPromo && (
            <div className="pointer-events-none absolute -right-4 -top-3 opacity-[0.12] blur-[0.5px]">
              <PromotionLogo promotion={e.promotion} size="lg" />
            </div>
          )}
        </div>
        <div className="absolute inset-0 bg-gradient-to-t from-ink-950 via-ink-950/70 to-transparent" />

        <div className="absolute inset-x-0 top-0 flex items-start justify-between gap-2 p-3">
          <span className="flex min-h-[1.5rem] min-w-0 items-center gap-1.5">
            {hasRealPromo && (
              <>
                <PromotionLogo promotion={e.promotion} size="sm" />
                <span className="truncate text-[0.68rem] font-semibold uppercase tracking-wide text-chalk drop-shadow">{promo.name}</span>
              </>
            )}
          </span>
          <span className="flex shrink-0 items-center gap-1.5">
            {/* A finished card leads with HOW it ended; that's the fact a fan
                scans for. "Pending" is keyed on RESOLVED, not on having a method —
                a decision that reached us without one still has a winner, and
                stamping it "Pending" beside "Tszyu def. Spence" contradicts the
                card's own headline. */}
            {!resolved ? (
              <Badge cls="border-ink-600 bg-ink-900/80 text-fog drop-shadow"><Hourglass className="size-2.5" />Pending</Badge>
            ) : method ? (
              <Badge cls={cn(method.cls, "drop-shadow")}>{method.label}</Badge>
            ) : (
              <Badge cls="border-up/40 bg-up/12 text-up drop-shadow">Result</Badge>
            )}
            <span
              className="inline-flex items-center rounded-md border px-2 py-0.5 text-[0.68rem] font-bold uppercase tracking-wider drop-shadow"
              style={{ color: accent, borderColor: `${accent}66`, background: `${accent}26` }}
            >
              {sportLabel}
            </span>
          </span>
        </div>

        <div className="absolute inset-x-0 bottom-0 p-3">
          {resolved && m ? (
            // The winner IS the card. Read at arm's length it should say one thing:
            // who won. So the name is the largest type on the surface and carries the
            // win colour, while the loser drops a full step in size, weight and
            // contrast and takes the loss colour. Colour alone is never the signal —
            // size, weight and the "def." label all say the same thing, so the card
            // still reads correctly in greyscale or to a colour-blind viewer.
            <>
              <p className="truncate font-display text-2xl font-black leading-[1.05] tracking-tight text-up drop-shadow-[0_2px_8px_rgba(0,0,0,0.85)] sm:text-[1.75rem]">
                {m.winnerName}
              </p>
              <p className="mt-0.5 flex items-baseline gap-1.5 truncate drop-shadow">
                <span className="shrink-0 text-[0.6rem] font-bold uppercase tracking-[0.14em] text-fog">def.</span>
                <span className="truncate font-display text-sm font-bold text-down">{m.loserName}</span>
              </p>
            </>
          ) : m ? (
            <p className="truncate font-display text-base font-black leading-tight text-chalk drop-shadow sm:text-lg">
              {m.redName} <span className="text-blood-400">vs</span> {m.blueName}
            </p>
          ) : (
            <p className="truncate font-display text-base font-black leading-tight text-chalk drop-shadow">{e.name}</p>
          )}
        </div>
      </div>

      <div className="flex-1 p-3.5">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-xs text-mist">
          <span>{timeAgo(e.date)}</span>
          {e.boutCount > 0 && (
            <span className="inline-flex items-center gap-1 text-fog">
              <Swords className="size-3.5 text-blood-400" />{e.boutCount} bout{e.boutCount === 1 ? "" : "s"}
            </span>
          )}
        </div>

        {resolved && m ? (
          <>
            <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
              {roundTime && <Badge cls="border-ink-600 bg-ink-800/70 text-mist">{roundTime}</Badge>}
              {m.titleFight && <Badge cls="border-gold-500/40 bg-gold-500/12 text-gold-300">Title</Badge>}
              {m.upset && <Badge cls="border-volt-500/40 bg-volt-500/12 text-volt-300"><Zap className="size-2.5" />Upset</Badge>}
              {(m.performanceBonus || m.fightOfTheNight) && (
                <Badge cls="border-gold-500/40 bg-gold-500/12 text-gold-300">{m.fightOfTheNight ? "FOTN" : "POTN"}</Badge>
              )}
            </div>
            {m.calledByPct != null && (
              <p className={cn("mt-2 text-[0.68rem] font-semibold", m.upset ? "text-volt-300" : "text-fog")}>
                {m.upset ? `Only ${m.calledByPct}% saw it coming` : `${m.calledByPct}% of the room called it`}
              </p>
            )}
          </>
        ) : (
          // The card happened but the outcome hasn't been ingested. Say what is
          // missing and what happens next — a reader can act on "checked hourly",
          // they can't act on "results aren't in yet".
          <p className="mt-2.5 text-[0.68rem] leading-snug text-fog">
            {e.pendingBouts > 0 && e.boutCount > 0
              ? `${e.pendingBouts} of ${e.boutCount} bouts still unconfirmed — sources are checked hourly.`
              : "Awaiting confirmed results — sources are checked hourly."}
          </p>
        )}
      </div>

      {/* Identity strip — what the card did to the viewer. The whole reason this
          surface exists; only rendered when there's a real delta to show. */}
      {e.viewer && e.viewer.graded > 0 ? (
        <div className={cn("flex items-center gap-2 border-t px-3.5 py-2.5 text-xs font-bold",
          e.viewer.correct > 0 ? "border-volt-500/25 bg-volt-500/[0.07] text-volt-300" : "border-ink-800 bg-ink-950/40 text-fog")}>
          {e.viewer.correct > 0 && <Check className="size-3.5 shrink-0" strokeWidth={3} />}
          <span className="flex-1">You went {e.viewer.correct}/{e.viewer.graded}</span>
          {e.viewer.repGained > 0 && (
            <span className="inline-flex items-center gap-1 text-gold-300"><Flame className="size-3" />+{e.viewer.repGained}</span>
          )}
        </div>
      ) : (
        <div className="flex items-center gap-1.5 border-t border-ink-800 bg-ink-950/40 px-3.5 py-2.5 text-[0.7rem] font-semibold text-fog transition-colors group-hover:text-chalk">
          See how the room did <ArrowRight className="size-3.5 transition-transform group-hover:translate-x-0.5" />
        </div>
      )}
    </Link>
  );
}
