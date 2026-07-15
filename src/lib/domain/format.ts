/**
 * Presentation-agnostic formatting helpers for dates, times and countdowns.
 * These take a reference "now" so callers (and tests) stay deterministic.
 */

export interface CountdownParts {
  days: number;
  hours: number;
  minutes: number;
  seconds: number;
  totalMs: number;
  past: boolean;
}

export function countdown(target: string | Date, now: Date = new Date()): CountdownParts {
  const targetMs = (typeof target === "string" ? new Date(target) : target).getTime();
  const diff = targetMs - now.getTime();
  const past = diff <= 0;
  const abs = Math.abs(diff);
  return {
    days: Math.floor(abs / 86_400_000),
    hours: Math.floor((abs % 86_400_000) / 3_600_000),
    minutes: Math.floor((abs % 3_600_000) / 60_000),
    seconds: Math.floor((abs % 60_000) / 1000),
    totalMs: diff,
    past,
  };
}

/** Compact countdown label, e.g. "3d 4h", "45m", "Live". */
export function countdownLabel(target: string | Date, now: Date = new Date()): string {
  const c = countdown(target, now);
  if (c.past) return "Started";
  if (c.days > 0) return `${c.days}d ${c.hours}h`;
  if (c.hours > 0) return `${c.hours}h ${c.minutes}m`;
  if (c.minutes > 0) return `${c.minutes}m`;
  return `${c.seconds}s`;
}

const DATE_FMT = new Intl.DateTimeFormat("en-GB", {
  weekday: "short",
  day: "numeric",
  month: "short",
  year: "numeric",
});

export function formatEventDate(iso: string): string {
  return DATE_FMT.format(new Date(iso));
}

/** Local start time in a given IANA timezone, e.g. "8:00 PM PDT". */
export function formatLocalTime(iso: string, timezone: string): string {
  return new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
    timeZone: timezone,
  }).format(new Date(iso));
}

/** Relative "time ago" for coverage / posts. */
export function timeAgo(iso: string, now: Date = new Date()): string {
  const diff = now.getTime() - new Date(iso).getTime();
  const mins = Math.round(diff / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.round(hrs / 24);
  if (days < 7) return `${days}d ago`;
  return formatEventDate(iso);
}

/** e.g. { wins: 21, losses: 1, draws: 0 } -> "21-1-0". */
export function formatRecord(r?: { wins: number; losses: number; draws: number }): string {
  if (!r) return "—";
  return `${r.wins}-${r.losses}-${r.draws}`;
}
