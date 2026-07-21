// ── Calendar export ─────────────────────────────────────────────────────────
// "Add to Calendar" is the cheapest retention mechanic there is: it moves an
// event out of our app and into the surface a fan already checks every morning.
//
// Apple Calendar, Outlook desktop and every other native client consume ICS, so
// ONE correct .ics file covers most of the matrix; Google and Outlook Web get
// deep links because they prefer a pre-filled compose URL.
//
// Pure functions, no server imports — the ICS route and the client button share
// exactly this logic.

export interface CalendarEvent {
  uid: string;
  title: string;
  start: Date;
  /** Cards run long; default to a 4-hour block so it reads as an evening. */
  durationMinutes?: number;
  description?: string;
  location?: string;
  url?: string;
}

const DEFAULT_DURATION = 240;

/** UTC basic-format timestamp: 20260724T200000Z */
function icsStamp(d: Date): string {
  return `${d.toISOString().replace(/[-:]/g, "").split(".")[0]}Z`;
}

const end = (e: CalendarEvent): Date =>
  new Date(e.start.getTime() + (e.durationMinutes ?? DEFAULT_DURATION) * 60_000);

/**
 * RFC 5545 escaping: backslash, semicolon and comma are delimiters, and a literal
 * newline must become the two-character sequence \n. Getting this wrong is how
 * an .ics silently fails to import.
 */
function esc(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");
}

/**
 * Fold long lines to 75 octets as the spec requires (continuation lines start
 * with a single space). Long event names + venues routinely exceed this, and
 * strict parsers reject unfolded content.
 */
function fold(line: string): string {
  if (line.length <= 75) return line;
  const parts: string[] = [line.slice(0, 75)];
  for (let i = 75; i < line.length; i += 74) parts.push(` ${line.slice(i, i + 74)}`);
  return parts.join("\r\n");
}

/** A complete, importable single-event calendar. CRLF line endings are required. */
export function buildIcs(e: CalendarEvent, now = new Date()): string {
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Combat Reviews//Events//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "BEGIN:VEVENT",
    `UID:${e.uid}`,
    `DTSTAMP:${icsStamp(now)}`,
    `DTSTART:${icsStamp(e.start)}`,
    `DTEND:${icsStamp(end(e))}`,
    `SUMMARY:${esc(e.title)}`,
    ...(e.description ? [`DESCRIPTION:${esc(e.description)}`] : []),
    ...(e.location ? [`LOCATION:${esc(e.location)}`] : []),
    ...(e.url ? [`URL:${esc(e.url)}`] : []),
    "BEGIN:VALARM",
    "TRIGGER:-PT1H",
    "ACTION:DISPLAY",
    "DESCRIPTION:First bell in one hour",
    "END:VALARM",
    "END:VEVENT",
    "END:VCALENDAR",
  ];
  return `${lines.map(fold).join("\r\n")}\r\n`;
}


export function googleCalendarUrl(e: CalendarEvent): string {
  const params = new URLSearchParams({
    action: "TEMPLATE",
    text: e.title,
    dates: `${icsStamp(e.start)}/${icsStamp(end(e))}`,
    details: [e.description, e.url].filter(Boolean).join("\n\n"),
    location: e.location ?? "",
  });
  return `https://calendar.google.com/calendar/render?${params.toString()}`;
}

export function outlookCalendarUrl(e: CalendarEvent): string {
  const params = new URLSearchParams({
    path: "/calendar/action/compose",
    rru: "addevent",
    subject: e.title,
    startdt: e.start.toISOString(),
    enddt: end(e).toISOString(),
    body: [e.description, e.url].filter(Boolean).join("\n\n"),
    location: e.location ?? "",
  });
  return `https://outlook.live.com/calendar/0/deeplink/compose?${params.toString()}`;
}

/** Filename-safe slug for the downloaded .ics. */
export const icsFilename = (slug: string): string => `${slug.replace(/[^a-z0-9-]/gi, "-")}.ics`;

