"use client";

import { cn } from "@/lib/utils";
import {
  DAY_MS,
  spokenRemaining,
  useCountdown,
  type Remaining,
  type Urgency,
} from "@/lib/use-countdown";

// ════════════════════════════════════════════════════════════════════════════
//  THE COUNTDOWN — the single loudest thing on an event surface.
//
//  ── What this replaced ─────────────────────────────────────────────────────
//  Four `text-xl` digits in a row, the same grey at three weeks out as at three
//  minutes out, with a colon between them. It read as metadata — the same weight
//  as the venue and the bout count — when it is the one number on the card that
//  changes while you look at it.
//
//  ── The escalation ─────────────────────────────────────────────────────────
//  There are four bands (lib/use-countdown), and each one is louder than the
//  last on FOUR axes at once, because any single axis is easy to miss:
//
//    band        colour        surface            motion        resolution
//    scheduled   chalk         ink slab           none          d : h : m
//    soon <7d    chalk         ink slab, lifted   none          d : h : m
//    urgent <24h volt          volt wash + glow   none          h : m : s
//    critical<1h blood         blood wash + glow  seconds pulse   m : s
//
//  RESOLUTION is the part that does the most work and costs nothing: a distant
//  event has no seconds to show, so seconds APPEARING is itself the signal that
//  the event is close, and the digits going from mostly-static to visibly
//  running is what makes the last day feel different from the last week.
//  Inside the hour the days and hours cells are dropped entirely, so the whole
//  control resolves down to two big numbers racing.
//
//  ── Accessibility ─────────────────────────────────────────────────────────
//  The digits are `aria-hidden` and the accessible name is a coarse sentence
//  ("2 days 4 hours"), refreshed at whatever rate the reader navigates to it.
//  There is deliberately NO aria-live: a polite live region on a per-second
//  clock makes a screen reader announce a number every second and renders the
//  rest of the page unusable. Motion is gated behind `motion-reduce`.
// ════════════════════════════════════════════════════════════════════════════

/** Per-band styling for the block variant. One object, so the bands cannot drift. */
const BAND: Record<Urgency, {
  slab: string;
  digit: string;
  unit: string;
  sep: string;
  /** Outer glow. Empty for the calm bands — a glow that is always on is not a signal. */
  glow: string;
}> = {
  scheduled: {
    slab: "border-ink-700 bg-ink-900/70",
    digit: "text-chalk",
    unit: "text-fog",
    sep: "text-ink-600",
    glow: "",
  },
  soon: {
    slab: "border-ink-600 bg-ink-900",
    digit: "text-white",
    unit: "text-mist",
    sep: "text-ink-600",
    glow: "",
  },
  urgent: {
    slab: "border-volt-500/45 bg-volt-500/10",
    digit: "text-volt-100",
    unit: "text-volt-300/80",
    sep: "text-volt-500/40",
    glow: "shadow-[0_0_28px_-6px_rgba(190,242,60,0.35)]",
  },
  critical: {
    slab: "border-blood-500/60 bg-blood-500/15",
    digit: "text-blood-100",
    unit: "text-blood-300/90",
    sep: "text-blood-500/50",
    glow: "shadow-[0_0_34px_-4px_rgba(225,29,42,0.55)]",
  },
};

/** Compact-variant colour, same four bands. */
const COMPACT_TONE: Record<Urgency, string> = {
  scheduled: "text-chalk",
  soon: "text-chalk",
  urgent: "text-volt-200",
  critical: "text-blood-200",
};

const SIZES = {
  sm: { digit: "text-2xl sm:text-3xl", slab: "min-w-[3.25rem] px-2 py-1.5", unit: "text-4xs", sep: "text-lg" },
  md: { digit: "text-3xl sm:text-4xl", slab: "min-w-[4rem] px-2.5 py-2", unit: "text-3xs", sep: "text-xl" },
  lg: { digit: "text-4xl sm:text-6xl", slab: "min-w-[4.75rem] px-3 py-2.5 sm:min-w-[5.75rem]", unit: "text-3xs", sep: "text-2xl sm:text-3xl" },
} as const;

/**
 * Which cells to show, by band.
 *
 * Dropping empty leading cells is not only decluttering — it is what makes the
 * remaining cells bigger on screen at the exact moment they matter most, without
 * any change in font size.
 */
function cellsFor(r: Remaining): Array<{ key: string; value: number; label: string; live: boolean }> {
  if (r.urgency === "critical") {
    return [
      { key: "m", value: r.minutes, label: "Min", live: false },
      { key: "s", value: r.seconds, label: "Sec", live: true },
    ];
  }
  if (r.urgency === "urgent") {
    return [
      { key: "h", value: r.hours, label: "Hrs", live: false },
      { key: "m", value: r.minutes, label: "Min", live: false },
      { key: "s", value: r.seconds, label: "Sec", live: true },
    ];
  }
  return [
    { key: "d", value: r.days, label: "Days", live: false },
    { key: "h", value: r.hours, label: "Hrs", live: false },
    { key: "m", value: r.minutes, label: "Min", live: false },
  ];
}

/**
 * A short, ALWAYS-TRUE urgency word.
 *
 * "Tonight" is only printed when the target really does fall on the reader's own
 * calendar day — an event 20 hours out is inside the urgent band but is usually
 * tomorrow, and a countdown that says "tonight" about tomorrow is the kind of
 * small lie that costs trust on the one screen where timing is the product.
 */
function urgencyWord(r: Remaining, now: number): string | null {
  if (r.urgency === "critical") return r.minutes < 5 ? "Any moment" : "Under an hour";
  if (r.urgency === "urgent") {
    const sameDay = new Date(now).toDateString() === new Date(now + r.ms).toDateString();
    return sameDay ? "Today" : "Within 24 hours";
  }
  return null;
}

export function Countdown({
  date,
  compact = false,
  size = "lg",
  className,
  /** What to render once first bell has passed. */
  endedLabel = "Live / Final",
}: {
  date: string;
  compact?: boolean;
  size?: keyof typeof SIZES;
  className?: string;
  endedLabel?: string;
}) {
  const { remaining, started, now } = useCountdown(date);

  // NOT MEASURED YET (server render + hydration pass). Reserve the exact layout
  // box the real clock will occupy and show nothing in it.
  //
  // The old component printed `endedLabel` in this state, so every upcoming
  // event on the site rendered the words "Live / Final" server-side and flashed
  // them until hydration. Holding the box also means the digits arrive without
  // shifting the card underneath them.
  if (started === null) {
    return compact ? (
      <span aria-hidden className={cn("inline-block h-4 w-24 rounded bg-ink-800/60", className)} />
    ) : (
      <div aria-hidden className={cn("flex items-stretch justify-center gap-1.5 opacity-0 sm:gap-2", className)}>
        <Slab value={0} label="Days" band={BAND.scheduled} size={SIZES[size]} />
        <Slab value={0} label="Hrs" band={BAND.scheduled} size={SIZES[size]} />
        <Slab value={0} label="Min" band={BAND.scheduled} size={SIZES[size]} />
      </div>
    );
  }

  if (!remaining) {
    return (
      <span className={cn("font-display text-sm font-bold uppercase tracking-wide text-blood-400", className)}>
        {endedLabel}
      </span>
    );
  }

  const spoken = spokenRemaining(remaining);

  if (compact) {
    return (
      <CompactCountdown r={remaining} spoken={spoken} className={className} />
    );
  }

  const band = BAND[remaining.urgency];
  const s = SIZES[size];
  const cells = cellsFor(remaining);
  // The SAME instant the digits were derived from — never a fresh `Date.now()`,
  // which is impure in render and could disagree with the numbers beside it.
  const word = now === null ? null : urgencyWord(remaining, now);

  return (
    <div
      role="timer"
      aria-label={`Starts in ${spoken}`}
      className={cn("flex flex-col items-center gap-2", className)}
    >
      {word && (
        <span
          className={cn(
            "rounded-full border px-2.5 py-0.5 font-display text-3xs font-black uppercase tracking-[0.18em]",
            remaining.urgency === "critical"
              ? "border-blood-500/60 bg-blood-500/20 text-blood-200"
              : "border-volt-500/50 bg-volt-500/15 text-volt-200",
          )}
        >
          {word}
        </span>
      )}

      <div aria-hidden className={cn("flex items-stretch justify-center gap-1.5 sm:gap-2", band.glow && "rounded-2xl", band.glow)}>
        {cells.map((c, i) => (
          <div key={c.key} className="flex items-stretch gap-1.5 sm:gap-2">
            {i > 0 && (
              <span className={cn("self-center font-display font-black leading-none", s.sep, band.sep)}>:</span>
            )}
            <Slab value={c.value} label={c.label} band={band} size={s} pulse={c.live && remaining.urgency === "critical"} />
          </div>
        ))}
      </div>
    </div>
  );
}

function Slab({
  value, label, band, size, pulse = false,
}: {
  value: number;
  label: string;
  band: (typeof BAND)[Urgency];
  size: (typeof SIZES)[keyof typeof SIZES];
  pulse?: boolean;
}) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center rounded-xl border transition-colors duration-500",
        band.slab,
        size.slab,
      )}
    >
      <span
        className={cn(
          "font-display font-black leading-none tabular-nums",
          size.digit,
          band.digit,
          // The seconds cell breathes inside the last hour. `motion-reduce`
          // stops it dead for anyone who has asked for that.
          pulse && "animate-pulse motion-reduce:animate-none",
        )}
      >
        {String(value).padStart(2, "0")}
      </span>
      <span className={cn("mt-1 font-display font-bold uppercase tracking-[0.16em]", size.unit, band.unit)}>
        {label}
      </span>
    </div>
  );
}

/**
 * The inline form, for cards and list rows.
 *
 * It escalates on the same bands — the point is that a card in a grid of twelve
 * can be picked out as "this one is tonight" from colour alone, before any digit
 * is read. Inside the hour it drops to a live MM:SS with a pulsing dot, which is
 * the shape every broadcaster uses for the same message.
 */
function CompactCountdown({ r, spoken, className }: { r: Remaining; spoken: string; className?: string }) {
  const tone = COMPACT_TONE[r.urgency];
  const pad = (n: number) => String(n).padStart(2, "0");

  const text =
    r.urgency === "critical" ? `${pad(r.minutes)}:${pad(r.seconds)}`
    : r.urgency === "urgent" ? `${pad(r.hours)}h ${pad(r.minutes)}m ${pad(r.seconds)}s`
    : `${r.days}d ${pad(r.hours)}h ${pad(r.minutes)}m`;

  return (
    <span
      role="timer"
      aria-label={`Starts in ${spoken}`}
      className={cn(
        "inline-flex items-center gap-1.5 font-display font-bold tabular-nums",
        // A step up in type size inside 24h. Small, but it is the difference
        // between the countdown sitting in the metadata row and rising out of it.
        r.ms < DAY_MS ? "text-sm font-black" : "text-sm",
        tone,
        className,
      )}
    >
      {r.urgency === "critical" && (
        <span
          aria-hidden
          className="size-1.5 shrink-0 animate-pulse rounded-full bg-blood-400 shadow-[0_0_8px] shadow-blood-500 motion-reduce:animate-none"
        />
      )}
      <span aria-hidden>{text}</span>
    </span>
  );
}
