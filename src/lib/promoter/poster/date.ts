// ════════════════════════════════════════════════════════════════════════════
//  Dates and times as fight posters actually print them.
//
//  Its own module because it carries the one decision in this pipeline that can
//  silently ruin an event: an AMBIGUOUS NUMERIC DATE.
//
//  "03/04/2026" is 3 April to most of the world and 4 March to the United
//  States. A poster carries no locale. Guessing gets it right most of the time
//  and wrong catastrophically — a card advertised a month early, fans told the
//  wrong night, predictions locking at the wrong moment — and the promoter has
//  no reason to re-check a field the app filled in confidently.
//
//  So this REFUSES to guess. Ambiguous input returns null, the field stays
//  empty, and the promoter types six characters. That is the correct trade and
//  it is the reason this logic is not inline in the parser.
//
//  PURE, and `now` is always injected, so every case below is testable and no
//  result depends on when the suite runs.
// ════════════════════════════════════════════════════════════════════════════

const MONTHS: Record<string, number> = {
  jan: 1, january: 1,
  feb: 2, february: 2,
  mar: 3, march: 3,
  apr: 4, april: 4,
  may: 5,
  jun: 6, june: 6,
  jul: 7, july: 7,
  aug: 8, august: 8,
  sep: 9, sept: 9, september: 9,
  oct: 10, october: 10,
  nov: 11, november: 11,
  dec: 12, december: 12,
};

const WEEKDAYS: Record<string, number> = {
  sun: 0, sunday: 0,
  mon: 1, monday: 1,
  tue: 2, tues: 2, tuesday: 2,
  wed: 3, weds: 3, wednesday: 3,
  thu: 4, thur: 4, thurs: 4, thursday: 4,
  fri: 5, friday: 5,
  sat: 6, saturday: 6,
};

/**
 * A regex alternation over a lookup table's keys, LONGEST FIRST.
 *
 * Longest-first is required, not tidiness: regex alternation is first-match, so
 * `nov|november` matches only "nov" and leaves "ember" behind, which then
 * breaks the `\b` that follows it.
 */
const alternation = (table: Record<string, number>): string =>
  Object.keys(table).sort((a, b) => b.length - a.length).join("|");

export interface ParsedDate {
  year: number;
  /** 1–12. */
  month: number;
  /** 1–31. */
  day: number;
  /**
   * True when the poster did not print a year and we chose one.
   *
   * Surfaced so the review step can flag it: an inferred year is the single
   * most likely thing on an extracted draft to be wrong, and it is invisible
   * once rendered as a normal date.
   */
  yearInferred: boolean;
  /**
   * The poster printed a weekday and it MATCHES the resolved date.
   *
   * This is a genuine corroboration, not decoration — see inferYear.
   */
  weekdayConfirmed: boolean;
  confidence: number;
}

/** Days in a month, honouring leap years. */
function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function isRealDate(year: number, month: number, day: number): boolean {
  if (month < 1 || month > 12) return false;
  if (day < 1) return false;
  return day <= daysInMonth(year, month);
}

/** Day of week for a Y/M/D, in UTC so no host timezone can shift it. */
const weekdayOf = (year: number, month: number, day: number): number =>
  new Date(Date.UTC(year, month - 1, day)).getUTCDay();

/**
 * Choose a year for a poster that printed only a day and a month.
 *
 * Posters advertise events that have not happened, so the answer is the next
 * occurrence at or after today — never a past one.
 *
 * ── The weekday trick ─────────────────────────────────────────────────────
 * Fight posters almost always print the weekday ("SATURDAY 14 NOVEMBER"),
 * because that is how a fan decides whether they can go. That weekday is real
 * information: 14 November is a Saturday only in certain years, so when a
 * weekday is present we can pick the year that actually matches instead of
 * assuming the nearest one.
 *
 * It also catches the case where the nearest occurrence is NOT the intended
 * one. Searching forward a few years and preferring a weekday match turns a
 * guess into a corroborated reading, and `weekdayConfirmed` records which it
 * was so the UI can say so.
 */
function inferYear(month: number, day: number, weekday: number | null, now: Date): { year: number; confirmed: boolean } {
  const startYear = now.getUTCFullYear();
  const todayUtc = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());

  const candidates: number[] = [];
  // Six years is far more than any poster needs and keeps a leap-day (29 Feb)
  // search inside the ~4-year cycle where a match is guaranteed to exist.
  for (let y = startYear; y <= startYear + 6; y++) {
    if (!isRealDate(y, month, day)) continue;
    if (Date.UTC(y, month - 1, day) >= todayUtc) candidates.push(y);
  }
  if (candidates.length === 0) return { year: startYear, confirmed: false };

  if (weekday !== null) {
    const match = candidates.find((y) => weekdayOf(y, month, day) === weekday);
    if (match !== undefined) return { year: match, confirmed: true };
  }
  return { year: candidates[0], confirmed: false };
}

/** Two-digit years on posters are always this century. "26" is 2026, not 1926. */
const expandYear = (raw: number): number => (raw < 100 ? 2000 + raw : raw);

/**
 * Parse a date out of one line of poster text.
 *
 * Returns null when there is no date, when the date is impossible, or — the
 * important case — when it is genuinely ambiguous.
 */
export function parsePosterDate(line: string, now: Date): ParsedDate | null {
  const text = line.toLowerCase();

  // A weekday anywhere on the line, used both to corroborate and to pick a year.
  //
  // The alternation is GENERATED from the lookup table, longest first, rather
  // than hand-written. A hand-written one had a real bug: `sat(?:day)?` cannot
  // match "saturday" (which is sat + URday), and neither could `weds?(?:day)?`
  // match "wednesday" — so the two most common fight nights of the week were
  // exactly the two that silently failed to corroborate a year. Deriving the
  // pattern from the keys makes every matched string a key by construction.
  let weekday: number | null = null;
  const weekdayMatch = new RegExp(`\\b(?:${alternation(WEEKDAYS)})\\b`).exec(text);
  if (weekdayMatch) weekday = WEEKDAYS[weekdayMatch[0]] ?? null;

  const monthNames = alternation(MONTHS);

  // ── "14 NOVEMBER 2026" / "14 NOV" / "14TH NOVEMBER" ─────────────────────
  // Ordinal suffixes are stripped: posters write "14TH" freely.
  const dayFirst = new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th)?\\s+(${monthNames})\\b(?:\\s*,?\\s*(\\d{4}|\\d{2}))?`);
  // ── "NOVEMBER 14, 2026" / "NOV 14" ──────────────────────────────────────
  const monthFirst = new RegExp(`\\b(${monthNames})\\s+(\\d{1,2})(?:st|nd|rd|th)?\\b(?:\\s*,?\\s*(\\d{4}|\\d{2}))?`);

  let day: number | null = null;
  let month: number | null = null;
  let year: number | null = null;

  const m1 = dayFirst.exec(text);
  const m2 = monthFirst.exec(text);
  // Whichever pattern matched EARLIER on the line wins outright, and every
  // component is then taken from that one match. Mixing them — the day from one
  // and the month from the other — would silently cross two different dates
  // printed on the same line.
  const preferDayFirst = m1 !== null && (m2 === null || m1.index <= m2.index);
  if (preferDayFirst && m1) {
    day = Number(m1[1]);
    month = MONTHS[m1[2]];
    year = m1[3] ? expandYear(Number(m1[3])) : null;
  } else if (m2) {
    month = MONTHS[m2[1]];
    day = Number(m2[2]);
    year = m2[3] ? expandYear(Number(m2[3])) : null;
  }

  if (day !== null && month !== undefined && month !== null) {
    const resolved = year !== null
      ? { year, confirmed: weekday !== null && weekdayOf(year, month, day) === weekday }
      : inferYear(month, day, weekday, now);
    if (!isRealDate(resolved.year, month, day)) return null;

    // A named month cannot be ambiguous, so the floor is high. A printed year
    // and a corroborating weekday each add to it.
    let confidence = 0.8;
    if (year !== null) confidence += 0.1;
    if (resolved.confirmed) confidence += 0.1;

    return {
      year: resolved.year,
      month,
      day,
      yearInferred: year === null,
      weekdayConfirmed: resolved.confirmed,
      confidence: Math.min(1, confidence),
    };
  }

  // ── ISO: 2026-11-14 ─────────────────────────────────────────────────────
  // Unambiguous by definition — the standard fixes the order.
  const iso = /\b(\d{4})-(\d{1,2})-(\d{1,2})\b/.exec(text);
  if (iso) {
    const [y, mo, d] = [Number(iso[1]), Number(iso[2]), Number(iso[3])];
    if (!isRealDate(y, mo, d)) return null;
    return {
      year: y, month: mo, day: d,
      yearInferred: false,
      weekdayConfirmed: weekday !== null && weekdayOf(y, mo, d) === weekday,
      confidence: 0.95,
    };
  }

  // ── All-numeric: 14/11/2026, 14.11.26, 11-14-2026 ───────────────────────
  //
  // THE REFUSAL. Exactly one of the two leading numbers may exceed 12; that one
  // is the day and the order is settled. If BOTH are 12 or under the line is
  // genuinely ambiguous between DD/MM and MM/DD, and there is no locale on a
  // poster to break the tie — so we return null and let the promoter say.
  const numeric = /\b(\d{1,2})[./-](\d{1,2})[./-](\d{4}|\d{2})\b/.exec(text);
  if (numeric) {
    const a = Number(numeric[1]);
    const b = Number(numeric[2]);
    const y = expandYear(Number(numeric[3]));

    const aIsDay = a > 12 && b <= 12;
    const bIsDay = b > 12 && a <= 12;
    if (!aIsDay && !bIsDay) return null; // ambiguous, or both impossible

    const d = aIsDay ? a : b;
    const mo = aIsDay ? b : a;
    if (!isRealDate(y, mo, d)) return null;

    return {
      year: y, month: mo, day: d,
      yearInferred: false,
      weekdayConfirmed: weekday !== null && weekdayOf(y, mo, d) === weekday,
      // Lower than a named month even though it is now unambiguous: the reading
      // depended on one number happening to exceed 12, which is a thin thread,
      // and OCR misreads digits far more often than it misreads "NOVEMBER".
      confidence: 0.7,
    };
  }

  return null;
}

/** What a time on a poster is FOR. */
export type TimeKind = "doors" | "firstBell" | "mainCard" | "prelims" | "weighIn" | "unknown";

export interface ParsedTime {
  kind: TimeKind;
  /** 0–23. */
  hour: number;
  /** 0–59. */
  minute: number;
  /**
   * The timezone abbreviation as PRINTED ("AEST", "ET", "GMT"), never resolved.
   *
   * Deliberately not converted to an offset: these abbreviations are ambiguous
   * worldwide (CST is Central Standard Time in two different countries, and
   * China Standard Time), and resolving one wrong moves an event by hours. The
   * venue's location is what determines the zone, and the venue is a later step
   * — so this is carried through as evidence rather than acted on here.
   */
  timezoneAbbr: string | null;
  confidence: number;
}

const TIME_LABELS: { kind: TimeKind; pattern: RegExp }[] = [
  { kind: "doors", pattern: /\bdoors?\b/ },
  { kind: "firstBell", pattern: /\bfirst\s*(bell|fight|bout)\b|\bbell\b/ },
  { kind: "mainCard", pattern: /\bmain\s*card\b/ },
  { kind: "prelims", pattern: /\bprelim/ },
  { kind: "weighIn", pattern: /\bweigh[\s-]*ins?\b/ },
];

/**
 * Every time on a line, with what it is for.
 *
 * A poster commonly puts two on one line ("DOORS 6:00 PM · FIRST BELL 7:00 PM"),
 * so this returns a list and attributes each time to the nearest label to its
 * LEFT — which is how they are always written.
 */
export function parsePosterTimes(line: string): ParsedTime[] {
  const text = line.toLowerCase();
  const out: ParsedTime[] = [];

  // 7:00 pm · 7pm · 19:00 · 7.00pm
  const re = /\b(\d{1,2})(?:[:.](\d{2}))?\s*(am|pm)?\b(?:\s*([a-z]{2,5}t))?/g;
  for (const m of text.matchAll(re)) {
    const raw = Number(m[1]);
    const minute = m[2] ? Number(m[2]) : 0;
    const meridiem = m[3];
    const tz = m[4];

    // Without am/pm a bare number under 13 could be either. Only 24-hour
    // readings (13–23) and explicit meridiems are trustworthy; "7" alone on a
    // poster is 7pm in practice but this will not assert that.
    if (!meridiem && (raw < 13 && !m[2])) continue;
    if (minute > 59) continue;

    let hour: number;
    if (meridiem) {
      if (raw < 1 || raw > 12) continue;
      hour = meridiem === "pm" ? (raw === 12 ? 12 : raw + 12) : (raw === 12 ? 0 : raw);
    } else {
      if (raw > 23) continue;
      hour = raw;
    }

    // The label is whichever appears closest before this time on the line.
    const before = text.slice(0, m.index);
    let kind: TimeKind = "unknown";
    let bestAt = -1;
    for (const label of TIME_LABELS) {
      const found = [...before.matchAll(new RegExp(label.pattern.source, "g"))].pop();
      if (found && found.index > bestAt) { bestAt = found.index; kind = label.kind; }
    }

    out.push({
      kind,
      hour,
      minute,
      timezoneAbbr: tz ? tz.toUpperCase() : null,
      // An unlabelled time is a number we found on a poster; it is not yet a
      // claim about when anything starts.
      confidence: kind === "unknown" ? 0.4 : meridiem ? 0.9 : 0.75,
    });
  }

  return out;
}
