import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import Image from "next/image";
import { ArrowLeft, Eye, Users, Swords, ExternalLink, Ticket, MapPin } from "lucide-react";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { getViewerPromoter } from "@/lib/promoter/repo";
import { promoterCapabilities } from "@/lib/promoter/verification";
import { Countdown } from "@/components/countdown";
import { Badge } from "@/components/ui/badge";
import { FightNight, type NightBout } from "@/components/promoter/fight-night";
import { formatDate } from "@/lib/utils";
import { DAY_MS } from "@/lib/use-countdown";

export const metadata: Metadata = {
  title: "Your event",
  robots: { index: false, follow: false },
};

/**
 * THE PROMOTER'S HOME for one event.
 *
 * ── Not an edit page ──────────────────────────────────────────────────────
 * Publishing redirects here, and this is deliberately NOT the review screen
 * again. The promoter has finished building; what they want now is to know how
 * it is doing and to be ready for fight night. Dropping them back into a form
 * would say "you are not done", which is the opposite of what publishing means.
 *
 * ── It transforms on the day ──────────────────────────────────────────────
 * Inside 24 hours of first bell, the dashboard's own content is replaced by
 * FightNight. Not a link to a separate "results mode" — a promoter cageside
 * should not have to find anything. The one screen they already have open
 * becomes the one screen they now need.
 */
export default async function PromoterEventPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await getCurrentUser();
  if (!user) redirect(`/account?returnTo=${encodeURIComponent(`/promoter/events/${id}`)}`);

  const promoter = await getViewerPromoter(user.id);
  if (!promoter) notFound();

  // Ownership is in the WHERE: an event belonging to another organisation is
  // indistinguishable from one that does not exist (CLAUDE.md rule 6).
  const event = await prisma.event.findFirst({
    where: { id, promoterOrgId: promoter.orgId },
    select: {
      id: true, slug: true, name: true, date: true, status: true,
      venue: true, city: true, posterUrl: true, ticketUrl: true, broadcaster: true,
      fights: {
        orderBy: { orderOnCard: "asc" },
        select: {
          id: true, orderOnCard: true, mainEvent: true, result: true, winnerId: true,
          redId: true, blueId: true,
          red: { select: { name: true } },
          blue: { select: { name: true } },
        },
      },
    },
  });
  if (!event) notFound();

  const fightIds = event.fights.map((f) => f.id);
  const [followers, predictions] = await Promise.all([
    prisma.favoriteEvent.count({ where: { eventId: event.id } }),
    fightIds.length ? prisma.fightPick.count({ where: { fightId: { in: fightIds } } }) : 0,
  ]);

  // This is an async SERVER component: it renders once per request, so reading
  // the clock here is a request-time fact, not the impure-render hazard the
  // rule is aimed at (a client component that re-renders unpredictably). The
  // live ticking is the client Countdown's job, below.
  // eslint-disable-next-line react-hooks/purity
  const msToBell = event.date.getTime() - Date.now();
  // Fight night is the day of, and stays on until results are in — a card that
  // ran late must not lose the recording screen at midnight.
  const isFightNight =
    promoterCapabilities(promoter.state).recordResults &&
    msToBell < DAY_MS &&
    event.fights.some((f) => f.result === "SCHEDULED" || f.result === null);

  const nightBouts: NightBout[] = event.fights.map((f) => ({
    id: f.id,
    order: f.orderOnCard,
    redName: f.red.name,
    blueName: f.blue.name,
    mainEvent: f.mainEvent,
    recorded:
      f.result === "DRAW" ? "DRAW"
      : f.result === "NO_CONTEST" ? "NO_CONTEST"
      : f.winnerId === f.redId ? "RED"
      : f.winnerId === f.blueId ? "BLUE"
      : null,
  }));

  return (
    <div className="container-cr max-w-3xl space-y-4 py-5">
      <div className="flex items-center gap-3">
        <Link
          href="/promoter"
          aria-label="Back to your events"
          className="tap grid size-9 shrink-0 place-items-center rounded-lg text-mist transition-colors hover:bg-ink-800 hover:text-chalk"
        >
          <ArrowLeft className="size-5" aria-hidden />
        </Link>
        <div className="min-w-0 flex-1">
          <h1 className="truncate font-display text-xl font-black uppercase tracking-tight text-chalk">
            {event.name}
          </h1>
          <p className="truncate text-xs text-fog">
            {formatDate(event.date.toISOString(), { weekday: "short", month: "short", day: "numeric" })}
            {event.venue && ` · ${event.venue}`}
          </p>
        </div>
        <Badge tone={event.status === "LIVE" ? "live" : "neutral"}>{event.status}</Badge>
      </div>

      {isFightNight ? (
        <FightNight eventId={event.id} bouts={nightBouts} />
      ) : (
        <>
          {/* The countdown leads — it is the fact the promoter is living with. */}
          {msToBell > 0 && (
            <div className="rounded-2xl border border-ink-800 bg-ink-900/50 p-4">
              <p className="mb-2 text-center font-display text-3xs font-bold uppercase tracking-[0.18em] text-fog">
                First bell in
              </p>
              <Countdown date={event.date.toISOString()} size="md" />
            </div>
          )}

          <div className="grid grid-cols-3 gap-2">
            <Stat icon={Users} label="Following" value={followers} />
            <Stat icon={Swords} label="Predictions" value={predictions} />
            <Stat icon={Eye} label="Bouts" value={event.fights.length} />
          </div>

          <div className="flex flex-col gap-3 rounded-2xl border border-ink-800 bg-ink-900/50 p-4 sm:flex-row">
            {event.posterUrl && (
              <div className="relative mx-auto aspect-[3/4] w-32 shrink-0 overflow-hidden rounded-xl border border-ink-700 sm:mx-0">
                <Image src={event.posterUrl} alt="" fill className="object-cover" sizes="128px" unoptimized />
              </div>
            )}
            <div className="min-w-0 flex-1 space-y-2 text-sm">
              {(event.venue || event.city) && (
                <p className="flex items-center gap-2 text-mist">
                  <MapPin className="size-4 shrink-0 text-blood-400" aria-hidden />
                  <span className="truncate">{[event.venue, event.city].filter(Boolean).join(", ")}</span>
                </p>
              )}
              {event.ticketUrl && (
                <p className="flex items-center gap-2 text-mist">
                  <Ticket className="size-4 shrink-0 text-blood-400" aria-hidden />
                  <a href={event.ticketUrl} target="_blank" rel="noopener noreferrer" className="truncate underline-offset-2 hover:underline">
                    Tickets
                  </a>
                </p>
              )}
              <Link
                href={`/events/${event.slug}`}
                className="tap inline-flex min-h-11 items-center gap-2 rounded-lg border border-ink-700 px-3.5 text-xs font-bold uppercase tracking-wider text-mist transition-colors hover:border-blood-500/50 hover:text-chalk"
              >
                <ExternalLink className="size-4" aria-hidden /> View the public page
              </Link>
            </div>
          </div>

          <div className="rounded-2xl border border-ink-800 bg-ink-900/50 p-4">
            <h2 className="mb-2.5 font-display text-sm font-black uppercase tracking-wider text-chalk">
              Fight card
            </h2>
            <ul className="space-y-1.5">
              {event.fights.map((f) => (
                <li key={f.id} className="flex items-center gap-2.5 rounded-lg border border-ink-800 px-3 py-2.5 text-sm">
                  <span className="grid size-6 shrink-0 place-items-center rounded-full bg-ink-800 text-3xs font-black text-fog">
                    {f.orderOnCard + 1}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-chalk">
                    {f.red.name} <span className="text-fog">vs</span> {f.blue.name}
                  </span>
                  {f.mainEvent && (
                    <span className="shrink-0 font-display text-4xs font-black uppercase tracking-wider text-volt-300">
                      Main
                    </span>
                  )}
                </li>
              ))}
            </ul>
          </div>

          {msToBell < DAY_MS * 3 && msToBell > 0 && (
            <p className="text-center text-xs text-fog">
              Fight-night mode opens automatically 24 hours before first bell.
            </p>
          )}
        </>
      )}
    </div>
  );
}

function Stat({ icon: Icon, label, value }: { icon: typeof Eye; label: string; value: number }) {
  return (
    <div className="rounded-xl border border-ink-800 bg-ink-900/50 p-3 text-center">
      <Icon className="mx-auto size-4 text-blood-400" aria-hidden />
      <p className="mt-1 font-display text-xl font-black tabular-nums text-chalk">
        {value.toLocaleString()}
      </p>
      <p className="text-3xs font-bold uppercase tracking-wider text-fog">{label}</p>
    </div>
  );
}

export const dynamic = "force-dynamic";
