"use client";

import Link from "next/link";
import Image from "next/image";
import {
  BadgeCheck, MapPin as MapPinIcon, Ticket, Users, TrendingUp, ChevronRight,
  Navigation, CalendarDays,
} from "lucide-react";
import { PromotionLogo } from "@/components/promotion-logo";
import { useCountdown, useCoarseNow, spokenRemaining } from "@/lib/use-countdown";
import { eventMapState, EVENT_STATE_STYLE, isPastState } from "@/lib/geo/event-state";
import { directionsUrl, type MapPin } from "@/lib/geo/types";
import { formatDistance } from "@/lib/geo/gazetteer";
import { cn } from "@/lib/utils";

// ════════════════════════════════════════════════════════════════════════════
//  EventMapPreview — the card a pin opens.
//
//  ── Why events get their own component ────────────────────────────────────
//  `PinDetail` renders four entity families (events, gyms, people, clubs) from
//  one branchy template. That was right while every family showed the same four
//  facts. An event does not: it has a poster, a promotion crest, a live
//  countdown, a headline bout, two community counts, a ticket link and a
//  verified-promoter badge — none of which a gym or a person has.
//
//  Adding all of that to PinDetail would mean seven more `pin.event && …`
//  branches inside a component that already carries four shapes, and every one
//  of them would render for gyms too until proven otherwise. So events get
//  their own component and PinDetail keeps the families it still serves. The
//  MARKER, the PREVIEW and the NAVIGATION stay separate concerns.
//
//  ── The performance contract ──────────────────────────────────────────────
//  This component fetches NOTHING. Everything it renders arrives in the
//  `pin.event` preview model that already shipped with the map payload — see
//  lib/geo/types. The heavy event (undercard, odds, broadcast, crowd splits) is
//  a route away behind "View event". Opening ten previews costs ten renders and
//  zero requests.
// ════════════════════════════════════════════════════════════════════════════

const DATE_FMT = new Intl.DateTimeFormat("en-GB", {
  weekday: "short", day: "numeric", month: "short", year: "numeric",
});
const TIME_FMT = new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit" });

/** Compact counts: a card is too small for "12,431 predictions". */
function compact(n: number): string {
  if (n < 1000) return String(n);
  if (n < 10_000) return `${(n / 1000).toFixed(1).replace(/\.0$/, "")}k`;
  if (n < 1_000_000) return `${Math.round(n / 1000)}k`;
  return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, "")}m`;
}

/**
 * The FIRST BELL countdown — the card's hero.
 *
 * ── Why it is the biggest thing under the poster ──────────────────────────
 * "When" is the question a map card exists to answer. Everything else on this
 * card (venue, main event, counts) helps somebody decide whether they care;
 * the countdown is what turns that into a plan. It was a small line beside the
 * date and read as metadata, so it is now a centred block with its own band
 * and digits large enough to take in without reading.
 *
 * Its own component so it — and ONLY it — re-renders on the shared clock's
 * one-second tick. Reading `useCountdown` in the card body would re-render the
 * poster, the crest and every stat once a second for three numbers.
 */
function CountdownBlock({ iso, compactMode }: { iso: string; compactMode?: boolean }) {
  const { remaining, started, now } = useCountdown(iso);
  const state = eventMapState({ status: null, date: iso, now });

  // `started === null` is the server and the hydration pass — genuinely not
  // measured. Render the calm date rather than guessing at "Live" or a zero.
  if (started === null || !remaining) {
    return (
      <div className="rounded-lg border border-ink-800 bg-ink-900/60 px-3 py-2.5 text-center">
        <p className="font-display text-3xs font-bold uppercase tracking-[0.2em] text-fog">
          {started === true ? "Under way" : "First bell"}
        </p>
        <p className="mt-1 font-display text-base font-black leading-none text-chalk">
          {started === true ? "Live now" : DATE_FMT.format(new Date(iso))}
        </p>
      </div>
    );
  }

  const { days, hours, minutes, seconds, urgency } = remaining;
  const hot = urgency === "critical" || urgency === "urgent";

  // Inside a day the seconds are the story; beyond it they are noise that
  // repaints every second for no information.
  const cells: { value: number; label: string }[] =
    days > 0
      ? [{ value: days, label: "Days" }, { value: hours, label: "Hrs" }, { value: minutes, label: "Min" }]
      : [{ value: hours, label: "Hrs" }, { value: minutes, label: "Min" }, { value: seconds, label: "Sec" }];

  return (
    <div
      className={cn(
        "rounded-lg border px-3 py-2.5 text-center transition-colors",
        hot ? "border-blood-500/40 bg-blood-500/10" : "border-ink-800 bg-ink-900/60",
      )}
      // Coarse, minutes-only sentence: a per-second live region would have a
      // screen reader announcing a new number every second, which makes the
      // rest of the page unusable. The digits below are aria-hidden.
      role="group"
      aria-label={`First bell in ${spokenRemaining(remaining)}`}
    >
      <p
        className={cn(
          "font-display text-3xs font-bold uppercase tracking-[0.2em]",
          state === "FIGHT_WEEK" ? "text-flame" : hot ? "text-blood-300" : "text-fog",
        )}
      >
        {state === "FIGHT_WEEK" ? "Fight week · First bell" : "First bell"}
      </p>

      <div className="mt-1.5 flex items-start justify-center gap-1" aria-hidden>
        {cells.map(({ value, label }, i) => (
          <span key={label} className="flex items-center gap-1">
            {i > 0 && (
              <span
                className={cn(
                  "font-display font-black leading-none tabular-nums",
                  compactMode ? "pb-3 text-2xl" : "pb-3.5 text-3xl",
                  hot ? "text-blood-500/50" : "text-ink-600",
                )}
              >
                :
              </span>
            )}
            <span className="flex flex-col items-center">
              <span
                className={cn(
                  "font-display font-black leading-none tabular-nums",
                  compactMode ? "text-2xl" : "text-3xl",
                  hot ? "text-blood-300" : "text-chalk",
                )}
              >
                {String(value).padStart(2, "0")}
              </span>
              <span className="mt-1 font-display text-3xs font-bold uppercase tracking-wider text-fog">
                {label}
              </span>
            </span>
          </span>
        ))}
      </div>
    </div>
  );
}

/** One stat cell in the community row. */
function Stat({
  icon: Icon, value, label,
}: { icon: typeof Users; value: string; label: string }) {
  return (
    <span className="flex min-w-0 flex-col items-center gap-0.5 rounded-lg bg-ink-900/70 px-2 py-1.5">
      <span className="flex items-center gap-1 font-display text-sm font-black leading-none text-chalk">
        <Icon className="size-3 text-fog" aria-hidden />
        {value}
      </span>
      <span className="truncate text-3xs uppercase tracking-wider text-fog">{label}</span>
    </span>
  );
}

export interface EventMapPreviewProps {
  pin: MapPin;
  /** Kilometres from the viewer, when they've shared a position. */
  distanceKm?: number | null;
  /**
   * How much room the card has.
   *
   *   sheet     the mobile bottom sheet — full detail, the reader pulled it up
   *   floating  the desktop anchored card — trims a little chrome
   *   compact   the PHONE anchored card — the tight one
   *
   * ── Why `compact` exists ─────────────────────────────────────────────────
   * The anchored card went to phones without a layout of its own: it rendered
   * the desktop card at the width of the screen. A 16:9 poster across a 390px
   * phone is 220px before a single fact, and the finished card ran to roughly
   * 500px against a map that is 72dvh — under 480px on a common phone. The
   * bottom of the card, both actions included, was clipped by the map's
   * `overflow-hidden`, and because nothing was scrollable there was no way to
   * reach it.
   *
   * FloatingPreview now caps the height and scrolls, so nothing can be lost.
   * This variant is the other half: it makes the card small enough that the cap
   * is a safety net rather than the normal case, because a card you have to
   * scroll to press "View event" is still a bad card.
   */
  variant?: "sheet" | "floating" | "compact";
}

/**
 * The premium event preview.
 *
 * Returns null when handed a pin with no event payload rather than rendering a
 * skeleton of empty rows — the caller decides what a non-event pin looks like
 * (it routes those to PinDetail), and a half-card here would be worse than the
 * generic one.
 */
export function EventMapPreview({ pin, distanceKm, variant = "sheet" }: EventMapPreviewProps) {
  const ev = pin.event;
  // The MINUTE clock, not the per-second one. This reading drives the badge,
  // the accent and the muting — none of which can change more than once a
  // minute. Subscribing the card body to the 1Hz clock would re-render the
  // poster, the crest and every stat once a second, which is exactly what
  // pulling CountdownBlock into its own component was meant to avoid.
  const now = useCoarseNow(60_000);
  if (!ev) return null;

  const state = eventMapState({ status: ev.status, date: pin.date, now });
  const style = EVENT_STATE_STYLE[state];
  const past = isPastState(state);
  const tight = variant === "compact";
  // Both anchored variants trim the same chrome; `compact` trims more on top.
  const floating = variant === "floating" || tight;
  const date = pin.date ? new Date(pin.date) : null;

  return (
    <article
      className={cn(
        "flex flex-col overflow-hidden rounded-xl border bg-ink-950",
        past ? "border-ink-800" : "border-ink-700",
      )}
      style={past ? undefined : { boxShadow: `0 0 0 1px ${style.accent}22` }}
    >
      {/* ── Poster banner ───────────────────────────────────────────────────
          A fight poster is the single most recognisable thing about a card, so
          it leads. 16:9 rather than the poster's native 2:3 — a full-height
          poster would push every fact below the fold of a floating card. */}
      {/* 16:9 is already a compromise against the poster's native 2:3. On a
          phone, where the card is as wide as the screen, even that is 220px of
          art above the first fact — so the compact layout crops harder. The
          poster is recognition, not the content. */}
      <div
        className={cn(
          "relative w-full shrink-0 overflow-hidden bg-ink-900",
          tight ? "aspect-[2.6/1]" : "aspect-[16/9]",
        )}
      >
        {pin.imageUrl ? (
          <Image
            src={pin.imageUrl}
            alt=""
            fill
            sizes={floating ? "360px" : "(max-width: 1024px) 100vw, 420px"}
            className={cn("object-cover", past && "opacity-45 saturate-50")}
            // Posters are promoter uploads and ingested art on arbitrary hosts;
            // the optimiser is not in front of every one of them.
            unoptimized
          />
        ) : (
          <div className="grid h-full w-full place-items-center bg-gradient-to-br from-ink-900 to-ink-950">
            <PromotionLogo promotion={pin.promotion} size="lg" />
          </div>
        )}

        {/* Legibility floor for the text over the art. */}
        <div
          aria-hidden
          className="absolute inset-0 bg-gradient-to-t from-ink-950 via-ink-950/45 to-transparent"
        />

        {/* State + verification badges */}
        <div className="absolute left-2.5 top-2.5 flex flex-wrap items-center gap-1.5">
          {style.badge && (
            <span
              className={cn(
                "inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 font-display text-3xs font-black uppercase tracking-wider",
                past ? "bg-ink-800 text-fog" : "text-white",
              )}
              style={past ? undefined : { background: style.accent }}
            >
              {style.pulse && <span className="live-dot" aria-hidden />}
              {style.badge}
            </span>
          )}
          {ev.verifiedPromoter && (
            <span
              className="inline-flex items-center gap-1 rounded-md bg-ink-950/85 px-1.5 py-0.5 font-display text-3xs font-bold uppercase tracking-wider text-volt-400 backdrop-blur-sm"
              title="Hosted by a promoter Combat Reviews has verified"
            >
              <BadgeCheck className="size-3" aria-hidden /> Verified
            </span>
          )}
        </div>

        {/* Sport, opposite corner — the fastest thing to scan a card by. */}
        <span className="absolute right-2.5 top-2.5 rounded-md bg-ink-950/85 px-1.5 py-0.5 font-display text-3xs font-bold uppercase tracking-wider text-mist backdrop-blur-sm">
          {ev.sport}
        </span>

        {/* Name + promotion, sitting on the gradient. */}
        <div className="absolute inset-x-0 bottom-0 p-2.5">
          <div className="flex items-end gap-2">
            <PromotionLogo promotion={pin.promotion} size="sm" />
            <div className="min-w-0 flex-1">
              {pin.subtitle && (
                <p className="truncate font-display text-3xs font-bold uppercase tracking-[0.14em] text-mist">
                  {pin.subtitle}
                </p>
              )}
              <h3
                className={cn(
                  "truncate font-display font-black leading-tight text-chalk",
                  floating ? "text-sm" : "text-base",
                  state === "CANCELLED" && "line-through decoration-fog/70",
                )}
              >
                {pin.name}
              </h3>
            </div>
          </div>
        </div>
      </div>

      <div className={cn("flex flex-col", tight ? "gap-2 p-2.5" : "gap-2.5 p-3")}>
        {/* ── First bell ──────────────────────────────────────────────────
            Full width and centred: it is the card's headline number, not a
            fact in a list. The exact date sits under it in a quieter line, so
            the block answers "how long" and "when" without competing. */}
        {past || !pin.date ? (
          <div className="flex items-center gap-1.5">
            <CalendarDays className="size-3.5 shrink-0 text-fog" aria-hidden />
            <span className="truncate font-display text-xs font-bold uppercase tracking-wide text-mist">
              {state === "CANCELLED"
                ? "Called off"
                : date
                  ? DATE_FMT.format(date)
                  : "Date to be confirmed"}
            </span>
          </div>
        ) : (
          <div>
            <CountdownBlock iso={pin.date} compactMode={floating} />
            {/* The exact date under the countdown is a second reading of the
                same fact. Worth the two lines on a card with room; the first
                thing to go on one without. */}
            {date && !tight && (
              <p className="mt-1.5 text-center text-2xs tabular-nums text-fog">
                {DATE_FMT.format(date)} · {TIME_FMT.format(date)}
              </p>
            )}
          </div>
        )}

        {/* ── Main event ──────────────────────────────────────────────────
            The headline bout is why most people tap a card at all, so it gets
            its own band rather than a line in a facts list. */}
        {ev.mainEvent && (
          <div className="flex items-center gap-2 rounded-lg border border-ink-800 bg-ink-900/60 px-2.5 py-2">
            <span className="min-w-0 flex-1 truncate text-right font-display text-xs font-bold text-chalk">
              {ev.mainEvent.red}
            </span>
            <span className="shrink-0 font-display text-3xs font-black uppercase tracking-wider text-blood-400">
              vs
            </span>
            <span className="min-w-0 flex-1 truncate font-display text-xs font-bold text-chalk">
              {ev.mainEvent.blue}
            </span>
          </div>
        )}

        {/* ── Venue / city ────────────────────────────────────────────────
            Venue leads, city is the quieter second line. Falls back to the
            city alone rather than printing an empty venue row. */}
        {(ev.venue || ev.city) && (
          <div className="flex items-start gap-1.5">
            <MapPinIcon className="mt-px size-3.5 shrink-0 text-fog" aria-hidden />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-xs text-mist">{ev.venue ?? ev.city}</span>
              {ev.venue && ev.city && (
                <span className="block truncate text-2xs text-fog">{ev.city}</span>
              )}
              {typeof distanceKm === "number" && (
                <span className="block text-2xs text-fog">{formatDistance(distanceKm)} away</span>
              )}
            </span>
          </div>
        )}

        {/* ── Community ───────────────────────────────────────────────────
            Hidden once the card is done: "0 predictions" on a finished event
            reads as a broken counter rather than as history. */}
        {/* Dropped on the compact card. Three counts are the least load-bearing
            thing here — the event page carries them, and "View event" is one
            tap away and must stay above the fold. */}
        {!tight && !past && (ev.followers > 0 || ev.predictions > 0 || (pin.presentNow ?? 0) > 0) && (
          <div className="grid grid-cols-3 gap-1.5">
            <Stat icon={Users} value={compact(ev.followers)} label="Following" />
            <Stat icon={TrendingUp} value={compact(ev.predictions)} label="Picks" />
            <Stat icon={MapPinIcon} value={compact(pin.presentNow ?? 0)} label="Here now" />
          </div>
        )}

        {/* ── Actions — ONE primary CTA ───────────────────────────────────
            Tickets and Directions are deliberately secondary and unfilled. Two
            filled buttons is two primary actions, and the card's job is to get
            somebody to the event. */}
        <div className="flex items-center gap-1.5">
          <Link
            href={pin.href ?? `/events/${ev.slug}`}
            className="tap inline-flex min-h-10 flex-1 items-center justify-center gap-1 rounded-lg bg-blood-500 px-3 font-display text-2xs font-black uppercase tracking-wider text-white transition-colors hover:bg-blood-400"
          >
            View event <ChevronRight className="size-3.5" aria-hidden />
          </Link>

          {/* No ticket link on a cancelled or finished card — see isPastState. */}
          {ev.ticketUrl && !past && (
            <a
              href={ev.ticketUrl}
              target="_blank"
              rel="noopener noreferrer nofollow"
              aria-label="Tickets"
              title="Tickets"
              className="tap cr-touch-target grid size-10 shrink-0 place-items-center rounded-lg border border-ink-600 bg-ink-800 text-chalk transition-colors hover:border-volt-500/60 hover:text-volt-400"
            >
              <Ticket className="size-4" aria-hidden />
            </a>
          )}

          <a
            href={directionsUrl(pin)}
            target="_blank"
            rel="noopener noreferrer"
            aria-label="Directions"
            title="Directions"
            className="tap cr-touch-target grid size-10 shrink-0 place-items-center rounded-lg border border-ink-600 bg-ink-800 text-chalk transition-colors hover:border-ink-500"
          >
            <Navigation className="size-4" aria-hidden />
          </a>
        </div>

        {/* Honesty about a city-centroid pin — the same note PinDetail carries,
            because the promise "Directions" makes has to be true. */}
        {pin.precision === "country" && (
          <p className="text-3xs leading-relaxed text-fog">
            Pinned to the country — we don&apos;t have this venue&apos;s exact position yet.
            Directions search for it by name.
          </p>
        )}
      </div>
    </article>
  );
}
