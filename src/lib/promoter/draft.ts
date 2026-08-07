// ════════════════════════════════════════════════════════════════════════════
//  Extraction → the thing the promoter edits.
//
//  PosterDraft is evidence: every value wrapped with a confidence and the line
//  it came from. That shape is right for the parser and wrong for a UI, which
//  wants plain strings it can bind to inputs plus a separate note of which ones
//  are shaky.
//
//  Splitting them here (pure, testable) rather than inside the component keeps
//  the "which fields need a look?" rule — the one that decides whether review
//  takes a minute or ten — out of JSX and under test.
// ════════════════════════════════════════════════════════════════════════════

import { LOW_CONFIDENCE, type PosterDraft } from "@/lib/promoter/poster/types";

export interface EditableBout {
  id: string;
  redName: string;
  blueName: string;
  weightClass: string;
  titleFight: boolean;
  uncertain: boolean;
}

export interface EditableDraft {
  eventName: string;
  promotion: string;
  /** ISO calendar date, `yyyy-mm-dd`, or "" when unknown. */
  date: string;
  /** `HH:MM` 24h, or "". */
  doorsTime: string;
  firstBellTime: string;
  timezoneAbbr: string;
  venue: string;
  city: string;
  countryCode: string;
  broadcaster: string;
  ticketUrl: string;
  bouts: EditableBout[];
  /**
   * Field keys extraction was unsure about, so the UI can mark exactly those.
   *
   * A set, not a per-field flag scattered through the shape, because the review
   * screen also wants the COUNT ("2 worth a check") and that has to be derived
   * from one place or the banner and the dots will disagree.
   */
  uncertainFields: Set<string>;
  /** Lines we could not place. Shown, never dropped. */
  leftovers: string[];
}

const pad = (n: number) => String(n).padStart(2, "0");

/** Convert extraction into editable values, recording what looked shaky. */
export function toEditableDraft(poster: PosterDraft): EditableDraft {
  const uncertain = new Set<string>();

  const take = (key: string, field: { value: string; confidence: number } | null): string => {
    if (!field) return "";
    if (field.confidence < LOW_CONFIDENCE) uncertain.add(key);
    return field.value;
  };

  let date = "";
  if (poster.date) {
    const { year, month, day, yearInferred } = poster.date.value;
    date = `${year}-${pad(month)}-${pad(day)}`;
    // An INFERRED year is always flagged regardless of the parser's score. It
    // is the single most likely thing on a draft to be wrong and the one thing
    // that is completely invisible once rendered as a normal date — the poster
    // simply did not say it, and we chose.
    if (yearInferred || poster.date.confidence < LOW_CONFIDENCE) uncertain.add("date");
  }

  const time = (key: string, field: { value: { hour: number; minute: number }; confidence: number } | null): string => {
    if (!field) return "";
    if (field.confidence < LOW_CONFIDENCE) uncertain.add(key);
    return `${pad(field.value.hour)}:${pad(field.value.minute)}`;
  };

  return {
    eventName: take("eventName", poster.eventName),
    promotion: poster.promotionSlug?.value ?? "",
    date,
    doorsTime: time("doorsTime", poster.doorsAt),
    firstBellTime: time("firstBellTime", poster.firstBellAt),
    timezoneAbbr: poster.timezoneAbbr ?? "",
    venue: take("venue", poster.venue),
    city: take("city", poster.city),
    countryCode: take("countryCode", poster.countryCode),
    broadcaster: "",
    ticketUrl: "",
    bouts: poster.bouts.map((b, i) => ({
      // Index-based but stable for the lifetime of this draft: the list is
      // rebuilt only when a new poster is read, and rows carry this id through
      // every reorder so React never remounts a row mid-drag.
      id: `bout-${i}`,
      redName: b.redName.value,
      blueName: b.blueName.value,
      weightClass: b.weightClass?.value ?? "",
      titleFight: b.titleFight,
      uncertain: Math.min(b.redName.confidence, b.blueName.confidence) < LOW_CONFIDENCE,
    })),
    uncertainFields: uncertain,
    leftovers: poster.unmatchedLines,
  };
}

/**
 * What is still missing before this can go public.
 *
 * Returns human sentences, not field names: the publish control uses these
 * verbatim, and "date is required" is a validation message whereas "Add the
 * date" is an instruction the promoter can act on without translating it.
 */
export function blockersToPublish(draft: EditableDraft): string[] {
  const out: string[] = [];
  if (!draft.eventName.trim()) out.push("Name the event");
  if (!draft.date) out.push("Add the date");
  if (!draft.venue.trim() && !draft.city.trim()) out.push("Say where it is");
  if (draft.bouts.length === 0) out.push("Add at least one bout");
  // A bout with one empty corner would publish as "Cole vs —", which reads as
  // a broken page rather than an unannounced opponent.
  else if (draft.bouts.some((b) => !b.redName.trim() || !b.blueName.trim())) {
    out.push("Every bout needs both corners");
  }
  return out;
}

/** How much of the draft is filled in — drives the review screen's progress. */
export function draftFilled(draft: EditableDraft): { done: number; total: number } {
  const checks = [
    draft.eventName.trim().length > 0,
    draft.date.length > 0,
    draft.venue.trim().length > 0 || draft.city.trim().length > 0,
    draft.bouts.length > 0,
    draft.firstBellTime.length > 0 || draft.doorsTime.length > 0,
    draft.bouts.every((b) => b.redName.trim() && b.blueName.trim()),
  ];
  return { done: checks.filter(Boolean).length, total: checks.length };
}

/**
 * Combine the calendar date and a wall-clock time into an instant.
 *
 * Returns null rather than a guess when either is missing. The timezone
 * abbreviation printed on a poster is deliberately NOT applied — see
 * poster/date.ts: those abbreviations are ambiguous worldwide and resolving one
 * wrong moves an event by hours. The value produced here is in the promoter's
 * OWN timezone, which is the correct assumption precisely because they are the
 * one looking at the screen while they confirm it.
 */
export function toEventDate(date: string, time: string): Date | null {
  if (!date) return null;
  const [y, m, d] = date.split("-").map(Number);
  if (!y || !m || !d) return null;
  const [hh, mm] = time ? time.split(":").map(Number) : [0, 0];
  const out = new Date(y, m - 1, d, hh || 0, mm || 0, 0, 0);
  return Number.isFinite(out.getTime()) ? out : null;
}
