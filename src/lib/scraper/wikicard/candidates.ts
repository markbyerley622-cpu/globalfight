// ════════════════════════════════════════════════════════════════════════════
//  Candidate scoring — reject a wrong page BEFORE paying to parse it.
//
//  PURE. Title-only signals, so this costs nothing and runs before any fetch.
//
//  The verification layer (verify.ts) already makes a wrong page harmless: nothing
//  is written unless the parsed card actually contains the bout we came for. But
//  harmless is not free. A historical repair run showed the retrieval engine
//  downloading and parsing:
//
//      List of transgender people                 1.27 MB
//      List of documentary films                  0.97 MB
//      List of Stanford University alumni         0.92 MB
//      Kansas City Chiefs                         0.86 MB
//      2026 New York State Senate election        0.78 MB
//      Heart of Midlothian F.C. / Castleford Tigers / The Dillinger Escape Plan
//      Back 4 Blood · Bloods · Blood donation     (from the event "BLOOD 4 BLOOD")
//      Dept. Q
//
//  — every one of them fetched in full and handed to cheerio to learn nothing. At
//  25 targets that is tolerable; at 1,754 bouts it is the whole cost of the run.
//
//  So search results become CANDIDATES and candidates are scored. Only those above
//  a threshold are parsed, best first, under a budget. The rule is a WHITELIST, not
//  a blocklist of topics: a page must carry a positive reason to be about this bout.
//  Blocklisting the world's subjects is unmaintainable — "Bloods" and "Dept. Q"
//  match no pattern anyone would think to write.
//
//  Selectivity here never lowers the truth bar. It only decides what is worth
//  reading; verify.ts still decides what may be written.
// ════════════════════════════════════════════════════════════════════════════

import { normalizeName } from "@/lib/entities/forms";
import type { ExpectedBout } from "./verify";

export interface CandidateContext {
  eventName: string;
  /** Canonical promotion name, or null when unattributed. */
  promotionName: string | null;
  /** Registry aliases for the promotion — "bare knuckle" finds far more than "BKFC". */
  promotionAliases: string[];
  /** The event's year, as a string. */
  eventYear: string | null;
  expectedBouts: ExpectedBout[];
}

/**
 * What KIND of page a candidate title looks like — and therefore how many of our
 * bouts it could possibly contain.
 *
 * Title similarity alone cannot express this, which is what let a fighter's
 * biography outrank a season page. "Lorenzo Hunt" is a near-perfect title match for
 * a bout involving Lorenzo Hunt and scores accordingly — but it can only ever carry
 * ONE of the thirteen bouts on that card, because it is one man's record. "2026 in
 * Bare Knuckle Fighting Championship" is a weaker title match and carries all
 * thirteen.
 */
export type CandidateKind = "season_page" | "event_page" | "fighter_bio" | "promotion_page" | "general";

/**
 * The most bouts a page of this kind can contribute, or null for "unbounded".
 *
 * A biography is capped at 1 by construction: it is one fighter's career record, and
 * a card has at most one bout per fighter. That cap is the fact the ranker needs.
 */
export function maxYieldFor(kind: CandidateKind): number | null {
  return kind === "fighter_bio" ? 1 : null;
}

export interface ScoredCandidate {
  title: string;
  score: number;
  /** Every signal that fired, so an accept or reject can explain itself. */
  reasons: string[];
  /** Page shape, which bounds how much of the card this candidate can supply. */
  kind: CandidateKind;
  /** `maxYieldFor(kind)`, carried so callers need not recompute it. */
  maxYield: number | null;
}

/** Minimum score worth a page fetch + parse. */
export const PARSE_THRESHOLD = Number(process.env.WIKICARD_PARSE_THRESHOLD ?? 20);
/** Most pages we will parse for ONE target, however many candidates score above it. */
export const PARSE_BUDGET = Number(process.env.WIKICARD_PARSE_BUDGET ?? 5);
/**
 * Fraction of a card's bouts that must be harvested before the event counts as
 * reconstructed rather than partially covered.
 *
 * Not 1.0 deliberately. A real card routinely has bouts Wikipedia never lists — a
 * scratched bout, an early prelim — so demanding every one would leave almost every
 * event permanently `partial` and re-attempted forever. 0.9 is high enough that a
 * single bout out of thirteen (7%) can never pass, which is the case this exists to
 * stop.
 */
export const COVERAGE_THRESHOLD = Number(process.env.WIKICARD_COVERAGE_THRESHOLD ?? 0.9);

const SCORE = {
  BOTH_FIGHTERS: 45, // both corners of one expected bout — near-certain
  ONE_FIGHTER: 16,
  VERSUS: 12, // "X vs Y" is an event/bout page shape
  PROMOTION: 15,
  EVENT_SHAPE: 12, // "UFC Fight Night: …", "2026 in Bare Knuckle Fighting Championship"
  YEAR: 6,
  EVENT_TITLE_ECHO: 20, // the candidate title IS (or contains) our event's title
  NOT_AN_EVENT: -45, // list / category / disambiguation / franchise page
  OWN_FIGHTER_BIO: 30, // a bio of a fighter ON THIS BOUT — carries their record table
  BIOGRAPHY: -20, // someone else's page: nothing about our bout
  /**
   * Applied when a candidate's page SHAPE cannot possibly cover the target.
   *
   * This is the incident fix. `own_fighter_bio` (30) plus `one_fighter` (16) scored
   * 46, beating a season page's `promotion`+`event_shape`+`year` (33) — so for a
   * 13-bout card the pipeline preferred a page capable of supplying ONE bout over
   * the page containing all thirteen, harvested that single bout, and reported the
   * event verified.
   *
   * DEMOTED, NOT DISQUALIFIED. -20 puts a bio (46) at 26: below the season page (33)
   * so a real card page is always preferred and parsed first, but still above
   * PARSE_THRESHOLD (20) so the bio remains reachable when nothing better exists.
   *
   * The first attempt at this used -34, landing the bio at 12 — under the threshold,
   * so it was never fetched at all. That broke boxing and MMA outright. Their events
   * are SYNTHETIC cards ("Boxing — 27 Jul 2026", assembled from the odds feed), so no
   * season or event page for them exists anywhere on Wikipedia; the fighter's career
   * record is the ONLY source, and a 2-bout card tripped `insufficient_yield:1/2` and
   * harvested nothing. Measured: 6 boxing targets went from partially resolved to 0
   * verified. A fallback that cannot be reached is not a fallback.
   *
   * With -20 the ordering is: real card page first, bio second. Combined with
   * best-coverage-wins the bio is only ever fetched when the card page is absent or
   * yielded less — and a bio that supplies 1 of 13 now reports `partial`, not
   * `verified`, which is the actual protection against a false completeness claim.
   */
  INSUFFICIENT_YIELD: -20,
} as const;

/**
 * Titles that are structurally never a fight card. Narrow and structural on
 * purpose — these are Wikipedia page-TYPE conventions, not topics.
 */
const NOT_AN_EVENT = [
  /^list of /i,
  /^category:/i,
  /^outline of /i,
  /^index of /i,
  /\(disambiguation\)/i,
  /\(TV series\)/i,
  /\(film\)/i,
  /\(album\)/i,
  /\(band\)/i,
  /\(video game\)/i,
  /\bdiscography\b/i,
  /\bfilmography\b/i,
  /\bF\.C\.\b/i,
  /\belection\b/i,
];

/** Page-title shapes that DO indicate a combat-sports event or card. */
const EVENT_SHAPE = [
  /^(UFC|BKFC|ONE|PFL|Bellator|GLORY|RIZIN|KSW|ADCC|Oktagon|Invicta|LFA)\b/i,
  /\bfight night\b/i,
  /\bin (bare knuckle|mixed martial arts|boxing|kickboxing)\b/i,
  /\bfight card\b/i,
  /\bboxing\b/i,
];

const words = (s: string) => new Set(normalizeName(s).split(" ").filter((w) => w.length > 3));

/**
 * A season/year-in-promotion page: "2026 in Bare Knuckle Fighting Championship".
 * These carry EVERY card of the year, so one fetch can complete many targets — and
 * the page cache means the second target that wants it pays nothing.
 */
const SEASON_SHAPE = /^\d{4}\s+in\s+/i;

/**
 * A season page states its year in its title. Reject the ones that disagree with the
 * event — BEFORE fetching, so it costs nothing.
 *
 * This closes a real correctness hole, not an efficiency one. `verifyCard` matches a
 * parsed bout to ours on the CORNER PAIR alone, and WikiBout carries no date, so on a
 * REMATCH the two meetings are indistinguishable. Observed in production:
 *
 *   BKFC FN HAMMOND VANCAMP (2026-06-26) ← "2025 in Bare Knuckle…" matched 1 bout
 *   BKFC 80 (2025-09-12)                 ← "2022 in Bare Knuckle…" matched 1 bout
 *   BKFC 79 (2025-08-02)                 ← "2023 in Bare Knuckle…" matched 2 bouts
 *
 * Each of those is a previous meeting of a pair that also fought on the target card
 * — and the card in question, "BKFC 85 … TROUT vs PALOMINO 2", is literally a
 * rematch. Nothing wrong was written only because best-coverage-wins happened to
 * prefer the right-year page every time; a target whose correct page does not exist
 * yet would have taken the old fight's winner, method and round.
 *
 * A year is unambiguous, present in the title, and free to check. Tolerance of ±1 is
 * deliberate: a card on 1 January is routinely listed on the previous year's page.
 */
const SEASON_YEAR_TOLERANCE = 1;

export function seasonYearMismatch(title: string, eventYear: string | null): boolean {
  const m = /^(\d{4})\s+in\s+/i.exec(title);
  if (!m || !eventYear) return false;
  const pageYear = Number(m[1]);
  const target = Number(eventYear);
  if (!Number.isFinite(pageYear) || !Number.isFinite(target)) return false;
  return Math.abs(pageYear - target) > SEASON_YEAR_TOLERANCE;
}

/**
 * Classify a candidate by page shape.
 *
 * Structural only — page-type conventions, never topic. Order matters: the checks run
 * most-specific first, and `fighter_bio` is deliberately tested before the generic
 * event shapes so that "Kai Stewart" cannot be read as an event just because the
 * promotion's name appears nowhere in it.
 */
export function classifyCandidate(title: string, ctx: CandidateContext): CandidateKind {
  if (SEASON_SHAPE.test(title)) return "season_page";
  if (isOwnFighterBio(title, ctx) || isBiographyTitle(title, ctx)) return "fighter_bio";
  if (/\bvs\.?\b|\bversus\b/i.test(title)) return "event_page";
  if (EVENT_SHAPE.some((re) => re.test(title))) return "event_page";
  // The promotion's own article ("Bare Knuckle Fighting Championship") — about the
  // organisation, not a card. It carries no bout table worth parsing.
  const promoTerms = [ctx.promotionName, ...ctx.promotionAliases].filter(Boolean) as string[];
  if (promoTerms.some((p) => normalizeName(title) === normalizeName(p))) return "promotion_page";
  return "general";
}

/**
 * Score one candidate title against what we are looking for. Deterministic, and
 * every contribution is named in `reasons`.
 */
export function scoreCandidate(title: string, ctx: CandidateContext): ScoredCandidate {
  const reasons: string[] = [];
  let score = 0;
  const hay = ` ${normalizeName(title)} `;
  const has = (s: string) => s.length > 2 && hay.includes(` ${s} `);

  // ── fighters: the strongest signal available from a title alone ────────────
  let best = 0;
  for (const bout of ctx.expectedBouts) {
    const red = surnameOf(bout.red.keys.canonical);
    const blue = surnameOf(bout.blue.keys.canonical);
    const hits = (has(red) ? 1 : 0) + (has(blue) ? 1 : 0);
    best = Math.max(best, hits);
  }
  if (best >= 2) { score += SCORE.BOTH_FIGHTERS; reasons.push("both_fighters"); }
  else if (best === 1) { score += SCORE.ONE_FIGHTER; reasons.push("one_fighter"); }

  // ── the event's own title, for a card-backfill target ──────────────────────
  const evWords = words(ctx.eventName);
  if (evWords.size) {
    const overlap = [...evWords].filter((w) => has(w)).length;
    // TWO distinctive words, not one. "Back 4 Blood" shares "blood" with the event
    // "BLOOD 4 BLOOD" and is a video game; one shared word is not evidence.
    if (overlap >= 2 || (evWords.size === 1 && overlap === 1)) {
      score += SCORE.EVENT_TITLE_ECHO;
      reasons.push(`event_title_echo:${overlap}`);
    }
  }

  // ── promotion, via its registry aliases ("bare knuckle" ≫ "BKFC") ──────────
  const promoTerms = [ctx.promotionName, ...ctx.promotionAliases].filter(Boolean) as string[];
  if (promoTerms.some((p) => hay.includes(` ${normalizeName(p)} `) || hay.includes(normalizeName(p)))) {
    score += SCORE.PROMOTION;
    reasons.push("promotion");
  }

  if (/\bvs\.?\b|\bversus\b/i.test(title)) { score += SCORE.VERSUS; reasons.push("versus"); }
  if (EVENT_SHAPE.some((re) => re.test(title))) { score += SCORE.EVENT_SHAPE; reasons.push("event_shape"); }
  if (ctx.eventYear && title.includes(ctx.eventYear)) { score += SCORE.YEAR; reasons.push("year"); }

  if (NOT_AN_EVENT.some((re) => re.test(title))) { score += SCORE.NOT_AN_EVENT; reasons.push("not_an_event"); }

  // A season page for the WRONG YEAR is disqualified outright, not merely demoted.
  // It can only ever contribute a PREVIOUS meeting of the same two fighters, which
  // pair-based verification cannot distinguish from the bout we want. See
  // seasonYearMismatch. NOT_AN_EVENT's weight puts it far below PARSE_THRESHOLD, so
  // it is refused before any fetch.
  if (seasonYearMismatch(title, ctx.eventYear)) {
    score += SCORE.NOT_AN_EVENT;
    reasons.push("wrong_season_year");
  }

  // ── biography ──────────────────────────────────────────────────────────────
  // A bio of a fighter ON THIS BOUT is now the single most useful page we can find.
  // Most bouts never get their own article — searching "Anthony Joshua vs Kristian
  // Prenga" returns three biographies and no fight page — but the fighter's own page
  // carries their complete professional record, and the row for this bout holds the
  // winner, method, round, time AND date. See record-table.ts.
  //
  // Someone ELSE's biography is still worthless: "Hughie Fury" shares a surname with
  // our fighter and has nothing to do with the bout.
  if (isOwnFighterBio(title, ctx)) {
    score += SCORE.OWN_FIGHTER_BIO;
    reasons.push("own_fighter_bio");
  } else if (isBiographyTitle(title, ctx)) {
    score += SCORE.BIOGRAPHY;
    reasons.push("biography");
  }

  // ── TARGET AWARENESS: can this page shape even cover what we need? ─────────
  //
  // Everything above scores the title against the target. None of it can express
  // "this page tops out at one bout and we need thirteen", which is how a fighter
  // biography came to outrank the season page carrying the whole card.
  //
  // Applied only when we need MORE than the shape can give. On a single-bout target
  // a bio's cap of 1 is sufficient, so it keeps its full score — it is the only
  // source for the long tail of bouts that never get an article.
  const kind = classifyCandidate(title, ctx);
  const cap = maxYieldFor(kind);
  const needed = ctx.expectedBouts.length;
  if (cap !== null && needed > cap) {
    score += SCORE.INSUFFICIENT_YIELD;
    reasons.push(`insufficient_yield:${cap}/${needed}`);
  }

  return { title, score, reasons, kind, maxYield: cap };
}

const surnameOf = (canonical: string) => canonical.split(" ").filter(Boolean).pop() ?? "";

/**
 * Is this page the biography of a fighter IN one of the bouts we are looking for?
 *
 * Exact whole-name match on the title (minus any "(boxer)" qualifier). A surname hit
 * is not enough — "Hughie Fury" would pass that and is a different person.
 */
export function isOwnFighterBio(title: string, ctx: CandidateContext): boolean {
  if (/\bvs\.?\b|\bversus\b/i.test(title)) return false;
  const bare = normalizeName(title.replace(/\s*\([^)]*\)\s*$/, ""));
  if (!bare) return false;
  return ctx.expectedBouts.some(
    (b) => normalizeName(b.red.name) === bare || normalizeName(b.blue.name) === bare,
  );
}

/**
 * Does this title look like one person's biography rather than an event?
 *
 * Structural: no "vs", and the title (minus any parenthetical qualifier) is a short
 * name-shaped string. "Errol Spence Jr." and "Josh Kelly (boxer)" are biographies;
 * "Errol Spence Jr. vs. Tim Tszyu" is not.
 */
export function isBiographyTitle(title: string, ctx: CandidateContext): boolean {
  if (/\bvs\.?\b|\bversus\b/i.test(title)) return false;
  // A list or category page is already classified as NOT_AN_EVENT. Letting it also
  // count as a "biography" would double-penalise it and, worse, print the wrong
  // reason in the retrieval report — and that report's whole value is being accurate
  // about why a page was refused.
  if (NOT_AN_EVENT.some((re) => re.test(title))) return false;
  const bare = title.replace(/\s*\([^)]*\)\s*$/, "").trim();
  const tokens = normalizeName(bare).split(" ").filter(Boolean);
  if (tokens.length < 2 || tokens.length > 4) return false;
  // A promotion or event-shaped title of the same length is not a biography.
  if (EVENT_SHAPE.some((re) => re.test(bare))) return false;
  const evWords = words(ctx.eventName);
  const overlap = tokens.filter((t) => evWords.has(t)).length;
  return overlap < 2;
}

export interface RankOpts {
  threshold?: number;
  budget?: number;
}

/**
 * Candidates worth parsing, best first and capped by the parse budget, plus the
 * ones we refused and why — a rejection has to be explainable, not invisible.
 */
export function rankCandidates(
  titles: string[],
  ctx: CandidateContext,
  opts: RankOpts = {},
): { parse: ScoredCandidate[]; rejected: ScoredCandidate[] } {
  const threshold = opts.threshold ?? PARSE_THRESHOLD;
  const budget = opts.budget ?? PARSE_BUDGET;

  const scored = titles.map((t) => scoreCandidate(t, ctx));
  // Stable: equal scores keep the source's own relevance order.
  const ordered = scored
    .map((c, i) => ({ c, i }))
    .sort((a, b) => b.c.score - a.c.score || a.i - b.i)
    .map((x) => x.c);

  const parse = ordered.filter((c) => c.score >= threshold).slice(0, budget);
  const keep = new Set(parse.map((c) => c.title));
  return { parse, rejected: ordered.filter((c) => !keep.has(c.title)) };
}
