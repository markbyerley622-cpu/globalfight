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

export interface ScoredCandidate {
  title: string;
  score: number;
  /** Every signal that fired, so an accept or reject can explain itself. */
  reasons: string[];
}

/** Minimum score worth a page fetch + parse. */
export const PARSE_THRESHOLD = Number(process.env.WIKICARD_PARSE_THRESHOLD ?? 20);
/** Most pages we will parse for ONE target, however many candidates score above it. */
export const PARSE_BUDGET = Number(process.env.WIKICARD_PARSE_BUDGET ?? 5);

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

  return { title, score, reasons };
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
