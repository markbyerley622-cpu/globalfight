// ════════════════════════════════════════════════════════════════════════════
//  POSTER → EVENT DRAFT.
//
//  The whole promise of the hosting flow is "upload one poster, review, publish"
//  and this is the part that makes it true. Everything else is plumbing around
//  it: OCR is a bought commodity, the wizard is forms — THIS is where a picture
//  becomes an event.
//
//  ── Design rules ──────────────────────────────────────────────────────────
//  1. PURE. No prisma, no fetch, no env, no clock — `now` is injected. Every
//     behaviour below is reachable from a unit test with a string array, which
//     is what lets it be tuned against real posters without a database.
//  2. NEVER INVENT. A field we cannot read stays null. The promoter fixing one
//     empty box is a five-second job; noticing that a confidently-populated box
//     is subtly wrong is not, and an event with a wrong date is worse than an
//     event with a missing one.
//  3. EVERY VALUE CARRIES ITS EVIDENCE. Confidence plus the source line, so the
//     review step can rank what needs a human eye instead of presenting forty
//     fields as equally trustworthy.
//  4. LEFTOVERS ARE RETURNED, not dropped — see PosterDraft.unmatchedLines.
//
//  ── Why type size is the primary signal ───────────────────────────────────
//  A fight poster is a hierarchy made of font sizes: the event name is the
//  biggest thing, then the main-event names, then the undercard, then the
//  small print. That is a design convention this format has had for a century,
//  and it is far more reliable than reading order — OCR reading order on a
//  two-column poster interleaves the columns. So where the provider gives
//  geometry we rank by box height and only fall back to order when it does not.
// ════════════════════════════════════════════════════════════════════════════

import { promotionFromText } from "@/lib/promotions";
import { toCountryCode } from "@/lib/countries";
import { parsePosterDate, parsePosterTimes } from "@/lib/promoter/poster/date";
import type { Extracted, ExtractedBout, OcrLine, PosterDraft } from "@/lib/promoter/poster/types";

/** Collapse whitespace and strip the decorative junk OCR picks off artwork. */
function clean(raw: string): string {
  return raw
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    // Leading/trailing separators and bullets used as poster ornament.
    .replace(/^[\s|·•*—–-]+|[\s|·•*—–-]+$/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

interface Line {
  text: string;
  /** Original index, i.e. reading order. */
  index: number;
  /** Type size proxy: box height when known, else 0. */
  size: number;
  confidence: number;
}

function prepare(lines: OcrLine[]): Line[] {
  return lines
    .map((l, index) => ({
      text: clean(l.text),
      index,
      size: l.box?.height ?? 0,
      // A provider that reports no confidence is treated as good-but-not-certain
      // rather than perfect; the parser's own pattern certainty then dominates.
      confidence: l.confidence ?? 0.85,
    }))
    .filter((l) => l.text.length > 0);
}

/** "VS" as posters write it, including the single-letter and full forms. */
const VS = /\s+(?:vs?\.?|versus)\s+/i;
/** A line that is ONLY the separator, used between two stacked name lines. */
const VS_ALONE = /^(?:vs?\.?|versus)$/i;

/**
 * Does this look like a person's name rather than a tagline or a venue?
 *
 * Deliberately permissive on the alphabet — fighters are named Þórir, Müller,
 * D'Angelo, Silva-Costa and O'Malley, and a parser that only accepts [A-Za-z]
 * quietly drops a chunk of the roster. It is strict on SHAPE instead: a name is
 * short, has one to four words, and does not contain the digits or the
 * furniture ("TICKETS", "PRESENTS", "LIVE ON") that decorate a poster.
 */
function looksLikeName(text: string): boolean {
  const t = text.trim();
  if (t.length < 2 || t.length > 40) return false;
  if (/\d/.test(t)) return false;
  const words = t.split(/\s+/);
  if (words.length > 4) return false;
  if (NON_NAME.test(t)) return false;
  // Must contain at least one run of letters. Unicode-aware so accented and
  // non-Latin names pass.
  return /\p{L}{2,}/u.test(t);
}

/** Poster furniture that is never a fighter's name. */
const NON_NAME =
  /\b(tickets?|presents?|proudly|live|stream|watch|doors?|bell|main|event|card|prelims?|undercard|round|title|championship|weigh|sold\s*out|on\s*sale|available|now|arena|stadium|centre|center|theatre|theater|hall|park|club|gym|promotions?|entertainment|sports?|network|channel|pay[\s-]*per[\s-]*view|ppv|broadcast|sponsored|official|www|http)\b/i;

/** Weight classes as printed beside a bout. */
const WEIGHT_CLASS =
  /\b((?:super\s+|light\s+|welter\s+|middle\s+|cruiser\s+|heavy\s+|feather\s+|bantam\s+|fly\s+|straw\s+|atom\s+)?(?:strawweight|atomweight|flyweight|bantamweight|featherweight|lightweight|welterweight|middleweight|cruiserweight|heavyweight|super\s*\w+weight|\w+weight))\b/i;

const TITLE_HINT = /\b(title|championship|belt|world\s+title|interim|vacant|for\s+the)\b/i;

/**
 * The bouts.
 *
 * Two layouts, because posters use both:
 *   A) one line — "ETHAN COLE VS MARCO SILVA"
 *   B) three lines — "ETHAN COLE" / "VS" / "MARCO SILVA"
 *
 * Layout B is why this walks the array rather than mapping it: the separator
 * line has to be consumed along with its two neighbours, and those neighbours
 * must not then be offered to the event-name detector.
 */
function extractBouts(lines: Line[], used: Set<number>): ExtractedBout[] {
  interface Found { red: string; blue: string; size: number; index: number; source: string; confidence: number }
  const found: Found[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (used.has(line.index)) continue;

    // ── Layout A ─────────────────────────────────────────────────────────
    if (VS.test(line.text)) {
      const parts = line.text.split(VS);
      if (parts.length === 2) {
        const [red, blue] = parts.map((p) => clean(p));
        if (looksLikeName(red) && looksLikeName(blue)) {
          found.push({
            red, blue, size: line.size, index: line.index,
            source: line.text, confidence: Math.min(line.confidence, 0.92),
          });
          used.add(line.index);
          continue;
        }
      }
    }

    // ── Layout B ─────────────────────────────────────────────────────────
    if (VS_ALONE.test(line.text) && i > 0 && i < lines.length - 1) {
      const before = lines[i - 1];
      const after = lines[i + 1];
      if (
        !used.has(before.index) && !used.has(after.index) &&
        looksLikeName(before.text) && looksLikeName(after.text)
      ) {
        found.push({
          red: before.text,
          blue: after.text,
          // The NAMES carry the type size, not the tiny "vs" between them.
          size: Math.max(before.size, after.size),
          index: before.index,
          source: `${before.text} vs ${after.text}`,
          confidence: Math.min(before.confidence, after.confidence, 0.9),
        });
        used.add(before.index);
        used.add(line.index);
        used.add(after.index);
      }
    }
  }

  if (found.length === 0) return [];

  // ── Card order ───────────────────────────────────────────────────────────
  // By type size where we have it: the main event is the biggest bout on the
  // poster, and that holds even when it is not printed first. Reading order is
  // the fallback, and it is genuinely worse — OCR walking a two-column
  // undercard interleaves the columns.
  const haveGeometry = found.some((f) => f.size > 0);
  const ordered = [...found].sort((a, b) =>
    haveGeometry ? b.size - a.size || a.index - b.index : a.index - b.index,
  );

  return ordered.map((f, i) => {
    // The weight class and title hint print NEAR the bout, not inside it, so
    // look at the lines bracketing it. Only unused lines, so a bout's own names
    // can never be mistaken for its division.
    const near = lines.filter(
      (l) => !used.has(l.index) && Math.abs(l.index - f.index) <= 2,
    );
    const wcLine = near.find((l) => WEIGHT_CLASS.test(l.text));
    const wc = wcLine ? WEIGHT_CLASS.exec(wcLine.text)?.[1] ?? null : null;

    return {
      redName: { value: f.red, confidence: f.confidence, source: f.source },
      blueName: { value: f.blue, confidence: f.confidence, source: f.source },
      orderOnCard: i,
      // Exactly one main event, always the first after ordering. A poster with
      // two "MAIN EVENT" captions is a poster we would otherwise believe twice.
      mainEvent: i === 0,
      weightClass: wc
        ? { value: wc, confidence: 0.75, source: wcLine!.text }
        : null,
      titleFight: near.some((l) => TITLE_HINT.test(l.text)),
    };
  });
}

/**
 * The event's own name.
 *
 * Biggest type that is not a fighter and not the small print. The promotion
 * registry gets first refusal: when a line names a promotion we already know
 * AND carries a number ("IRONFORGE FIGHT NIGHT 12"), that is the event title in
 * the form fans search for, and it beats whatever happens to be set largest.
 */
function extractEventName(lines: Line[], used: Set<number>): Extracted<string> | null {
  const candidates = lines.filter(
    (l) => !used.has(l.index) && l.text.length >= 3 && l.text.length <= 60 && !NON_NAME.test(l.text),
  );
  if (candidates.length === 0) return null;

  const numbered = candidates.filter((l) => /\d/.test(l.text) && promotionFromText(l.text));
  if (numbered.length > 0) {
    const best = numbered.sort((a, b) => b.size - a.size || a.index - b.index)[0];
    used.add(best.index);
    return { value: best.text, confidence: Math.min(best.confidence, 0.9), source: best.text };
  }

  const haveGeometry = candidates.some((l) => l.size > 0);
  const best = [...candidates].sort((a, b) =>
    haveGeometry ? b.size - a.size || a.index - b.index : a.index - b.index,
  )[0];
  used.add(best.index);
  return {
    value: best.text,
    // Lower without geometry: "the first line we did not otherwise use" is a
    // much weaker claim than "the largest type on the poster".
    confidence: haveGeometry ? Math.min(best.confidence, 0.8) : 0.55,
    source: best.text,
  };
}

/**
 * Venue, city and country.
 *
 * The most conservative extractor here, on purpose. A venue line and a tagline
 * are hard to tell apart, and the cost of guessing is an event advertised at
 * the wrong place — so this only claims a country when `toCountryCode` (the
 * app's existing gazetteer) recognises a token, and only claims a venue when it
 * finds the venue vocabulary. Everything else is left for the promoter.
 */
const VENUE_WORDS =
  /\b(arena|stadium|centre|center|theatre|theater|hall|park|coliseum|colosseum|dome|pavilion|garden|forum|auditorium|convention|expo|casino|resort|ballroom|club)\b/i;

function extractPlace(lines: Line[], used: Set<number>): {
  venue: Extracted<string> | null;
  city: Extracted<string> | null;
  countryCode: Extracted<string> | null;
} {
  let venue: Extracted<string> | null = null;
  let city: Extracted<string> | null = null;
  let countryCode: Extracted<string> | null = null;

  for (const line of lines) {
    if (used.has(line.index)) continue;

    // A comma-separated locality line: "Riverstage, Brisbane, Australia".
    const parts = line.text.split(",").map((p) => clean(p)).filter(Boolean);
    if (parts.length >= 2) {
      const tail = parts[parts.length - 1];
      const code = toCountryCode(tail);
      if (code) {
        countryCode ??= { value: code, confidence: 0.85, source: line.text };
        if (parts.length >= 3) {
          city ??= { value: parts[parts.length - 2], confidence: 0.7, source: line.text };
          venue ??= { value: parts[0], confidence: 0.7, source: line.text };
        } else {
          city ??= { value: parts[0], confidence: 0.65, source: line.text };
        }
        used.add(line.index);
        continue;
      }
    }

    if (!venue && VENUE_WORDS.test(line.text) && line.text.length <= 60) {
      venue = { value: line.text, confidence: 0.7, source: line.text };
      used.add(line.index);
      continue;
    }

    // A bare country name on its own line.
    if (!countryCode && parts.length === 1) {
      const code = toCountryCode(line.text);
      if (code) {
        countryCode = { value: code, confidence: 0.75, source: line.text };
        used.add(line.index);
      }
    }
  }

  return { venue, city, countryCode };
}

/**
 * Read a poster's text into an event draft.
 *
 * `now` is injected rather than read from the clock so that year inference (a
 * poster printing "SATURDAY 14 NOVEMBER" with no year) is deterministic and
 * testable. Callers pass `new Date()`.
 */
export function parsePoster(rawLines: OcrLine[], now: Date): PosterDraft {
  const lines = prepare(rawLines);
  // Claimed lines, so nothing is read twice — a fighter's name must not also
  // become the event title, and the date line must not become the venue.
  const used = new Set<number>();

  // ORDER MATTERS. Bouts first because they are the most confidently
  // identifiable thing on a poster (the "vs" is unambiguous), which removes the
  // biggest, most name-like lines from contention before the event-name
  // detector — which otherwise reaches for exactly those, since main-event
  // names are often the largest type of all.
  const bouts = extractBouts(lines, used);

  // Date and times next: also high-signal, and they free the small print.
  let date: PosterDraft["date"] = null;
  let doorsAt: PosterDraft["doorsAt"] = null;
  let firstBellAt: PosterDraft["firstBellAt"] = null;
  let timezoneAbbr: string | null = null;

  for (const line of lines) {
    if (used.has(line.index)) continue;

    if (!date) {
      const parsed = parsePosterDate(line.text, now);
      if (parsed) {
        date = {
          value: {
            year: parsed.year, month: parsed.month, day: parsed.day,
            yearInferred: parsed.yearInferred,
          },
          confidence: Math.min(line.confidence, parsed.confidence),
          source: line.text,
        };
        used.add(line.index);
        continue;
      }
    }

    const times = parsePosterTimes(line.text);
    const doors = times.find((t) => t.kind === "doors");
    const bell = times.find((t) => t.kind === "firstBell" || t.kind === "mainCard");
    if (doors || bell) {
      if (doors && !doorsAt) {
        doorsAt = {
          value: { hour: doors.hour, minute: doors.minute },
          confidence: Math.min(line.confidence, doors.confidence),
          source: line.text,
        };
      }
      if (bell && !firstBellAt) {
        firstBellAt = {
          value: { hour: bell.hour, minute: bell.minute },
          confidence: Math.min(line.confidence, bell.confidence),
          source: line.text,
        };
      }
      timezoneAbbr ??= doors?.timezoneAbbr ?? bell?.timezoneAbbr ?? null;
      used.add(line.index);
    }
  }

  const place = extractPlace(lines, used);

  // The promotion is matched over the WHOLE poster rather than one line: the
  // org's name and the event number are often set on separate lines, and the
  // registry matcher is a substring search that does not care where it sits.
  const promoText = lines.map((l) => l.text).join(" ");
  const promoSlug = promotionFromText(promoText);
  const promotionSlug: Extracted<string> | null = promoSlug
    ? { value: promoSlug, confidence: 0.85, source: promoText.slice(0, 120) }
    : null;

  // AFTER everything else, so it competes only for what is left.
  const eventName = extractEventName(lines, used);

  return {
    eventName,
    promotionSlug,
    date,
    doorsAt,
    firstBellAt,
    timezoneAbbr,
    venue: place.venue,
    city: place.city,
    countryCode: place.countryCode,
    bouts,
    unmatchedLines: lines.filter((l) => !used.has(l.index)).map((l) => l.text),
  };
}

/**
 * How much of this draft is worth showing.
 *
 * Used to decide whether extraction is worth presenting at all: a poster that
 * yielded nothing but an event name should drop the promoter straight into
 * manual entry rather than parade an almost-empty review step as a result.
 */
export function draftCompleteness(draft: PosterDraft): number {
  const checks = [
    draft.eventName !== null,
    draft.date !== null,
    draft.venue !== null || draft.city !== null,
    draft.bouts.length > 0,
    draft.firstBellAt !== null || draft.doorsAt !== null,
  ];
  return checks.filter(Boolean).length / checks.length;
}
