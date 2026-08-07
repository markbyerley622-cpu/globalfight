import * as cheerio from "cheerio";
import type { Element } from "domhandler";

// ════════════════════════════════════════════════════════════════════════════
//  SECTION-SCOPED EXTRACTION — reading ONE event out of an article that
//  documents many.
//
//  ── The problem, measured ────────────────────────────────────────────────
//  Most ONE Championship events that still have no card never had a Wikipedia
//  article of their own. They are documented inside a yearly article —
//  "2025 in ONE Championship" is 1.18 MB and carries every card of the year.
//  Handed to the extractor whole it yields hundreds of bouts, so attaching it
//  to a single event is catastrophic: production triage reported 39/40 events
//  as "parsed" purely because the season page parsed, which is exactly the
//  contamination the pipeline refuses these pages to avoid.
//
//  So the refusal is right and stays. What this module adds is the ability to
//  cut ONE event's section out of the document first, and parse only that.
//
//  ── Why it is generic ────────────────────────────────────────────────────
//  Nothing here knows about ONE. Wikipedia consolidates events into yearly or
//  series articles for UFC, KSW, PFL, RIZIN, Bellator and older boxing too, and
//  they all render the same way: a flat run of siblings under
//  `.mw-parser-output`, punctuated by heading elements. A "section" is the run
//  of nodes between one heading and the next heading of the same or higher
//  level. That is the whole model.
//
//  ── The safety rule ──────────────────────────────────────────────────────
//  Ambiguity is answered with NOTHING, never with a guess. If no heading
//  matches the event, or two match equally well, there is no window and the
//  caller falls back to refusing the page. A wrong window silently attributes
//  one event's bouts to another, which is worse than an empty card because it
//  looks like data.
// ════════════════════════════════════════════════════════════════════════════

/** One heading and the span of the document it owns. */
export interface Section {
  /** Heading text, cleaned of "[edit]" and reference markers. */
  heading: string;
  /** 2 for `h2`, 3 for `h3`, … Drives where the section ends. */
  level: number;
  /** Index into the parser-output child list where the heading sits. */
  start: number;
  /** Exclusive end: the next heading at the same or higher level, or the end. */
  end: number;
}

const clean = (s: string): string =>
  s.replace(/\[\s*edit\s*\]/gi, " ").replace(/\[\d+\]/g, " ").replace(/\s+/g, " ").trim();

/**
 * The heading level of a node, or 0 when it is not a heading.
 *
 * Wikipedia's `action=parse` output wraps headings in `<div class="mw-heading
 * mw-heading3">` rather than emitting a bare `<h3>`. Older cached HTML still
 * has the bare tag, so both are recognised — matching only one of them silently
 * produces a document with no sections at all, and a "no window" result that
 * looks like an honest miss.
 */
function headingLevel($: cheerio.CheerioAPI, node: Element): number {
  const tag = node.tagName?.toLowerCase();
  if (tag && /^h[1-6]$/.test(tag)) return Number(tag[1]);
  const cls = $(node).attr("class") ?? "";
  if (!cls.includes("mw-heading")) return 0;
  const m = cls.match(/mw-heading(\d)/);
  if (m) return Number(m[1]);
  const inner = $(node).find("h1,h2,h3,h4,h5,h6").first();
  const innerTag = inner.get(0)?.tagName?.toLowerCase();
  return innerTag ? Number(innerTag[1]) : 0;
}

/**
 * Index every section in an article, once.
 *
 * Built once per page and reused for every event that resolves to it — the
 * production run fetched "2025 in ONE Championship" thirty times for thirty
 * events, and re-indexing it thirty times would repeat that waste in CPU.
 */
export function indexSections(html: string): { $: cheerio.CheerioAPI; nodes: Element[]; sections: Section[] } {
  const $ = cheerio.load(html);
  const root = $(".mw-parser-output").first();
  const container = root.length ? root : $.root().children().first();
  const nodes = container.children().toArray() as Element[];

  const heads: { i: number; level: number; heading: string }[] = [];
  nodes.forEach((n, i) => {
    const level = headingLevel($, n);
    if (level > 0) {
      const text = clean($(n).text());
      if (text) heads.push({ i, level, heading: text });
    }
  });

  const sections: Section[] = heads.map((h, k) => {
    // Ends at the next heading of the SAME OR HIGHER rank. A deeper subsection
    // ("Results", "Bonus awards") belongs to this event and must stay inside the
    // window; the next sibling event must not.
    let end = nodes.length;
    for (let j = k + 1; j < heads.length; j++) {
      if (heads[j].level <= h.level) { end = heads[j].i; break; }
    }
    return { heading: h.heading, level: h.level, start: h.i, end };
  });

  return { $, nodes, sections };
}

/** The HTML of one section, heading excluded — the extraction window. */
export function sectionHtml(
  $: cheerio.CheerioAPI,
  nodes: Element[],
  section: Section,
): string {
  const parts: string[] = [];
  // start + 1 drops the heading itself: it carries no bouts and including it
  // only risks its text being read as table content.
  for (let i = section.start + 1; i < section.end; i++) {
    parts.push($.html(nodes[i]) ?? "");
  }
  return parts.join("");
}

// ── Matching a heading to an event ──────────────────────────────────────────

/**
 * Comparable form of a title: lowercase, unaccented, punctuation-free.
 *
 * "ONE Friday Fights 35" and "ONE Friday Fights 35: Superlek vs. Takeru" must
 * compare as the same event, while "ONE Friday Fights 3" must not match
 * "ONE Friday Fights 35" — which is why the token comparison below is exact per
 * token rather than a substring test. `includes("one friday fights 3")` is true
 * of "one friday fights 35", and that single detail decides whether a card
 * lands on the right event or the wrong one.
 */
export function normalizeTitle(raw: string): string {
  return raw
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

const tokens = (s: string): string[] => normalizeTitle(s).split(" ").filter(Boolean);

/**
 * How well a heading identifies this event, 0–1.
 *
 * Every token of the event name must be present in the heading, IN ORDER, as a
 * whole token. That is deliberately strict: a season page lists dozens of
 * near-identical headings ("ONE Friday Fights 34", "…35", "…36") and a fuzzy
 * score would rank them all within noise of each other.
 */
/** Whether every token of `inner` appears in `outer`, in order, as a whole token. */
function containedInOrder(inner: string[], outer: string[]): boolean {
  let hi = 0;
  for (const t of inner) {
    const at = outer.indexOf(t, hi);
    if (at < 0) return false;
    hi = at + 1;
  }
  return true;
}

const NUMERIC = /^\d+$/;

export function headingScore(eventName: string, heading: string): number {
  const want = tokens(eventName);
  const have = tokens(heading);
  if (want.length < 2 || have.length < 2) return 0;

  // ── Containment is BIDIRECTIONAL, because both sides carry extra words ──
  //
  // Our stored name is often longer than the heading: the DB has
  // "ONE Fight Night 33: Rodrigues Vs. Persson on Prime Video" where Wikipedia's
  // heading is "ONE Fight Night 33". Requiring the whole event name to appear in
  // the heading refused that outright — a real, findable card lost to three
  // words of broadcast branding. The heading can equally be the longer one
  // ("ONE Friday Fights 35: Superlek vs Takeru").
  //
  // Either direction is an identification; neither is a fuzzy match. Every token
  // must be present exactly and in order, which is what keeps
  // "ONE Friday Fights 3" from matching a heading for "…35": as TOKENS, "3" and
  // "35" are simply different, where any substring test would conflate them.
  const eventInHeading = containedInOrder(want, have);
  const headingInEvent = containedInOrder(have, want);
  if (!eventInHeading && !headingInEvent) return 0;

  // The numbers have to agree. "ONE 172" and "ONE 172 Kids Day" share a
  // discriminator; "ONE Fight Night 33" and "ONE Fight Night 3" do not, and
  // ordered containment alone would let a shorter number through when the
  // longer name happens to repeat it later.
  const wantNums = want.filter((t) => NUMERIC.test(t));
  const haveNums = have.filter((t) => NUMERIC.test(t));
  if (wantNums.length && haveNums.length) {
    const shared = haveNums.some((n) => wantNums.includes(n));
    if (!shared) return 0;
  }

  // Score by how much of the SHORTER side was consumed — a complete match in
  // either direction is a complete identification. Ties are broken on section
  // depth by the caller, not by inventing precision here.
  const overlap = Math.min(want.length, have.length) / Math.max(want.length, have.length);
  // A heading that is exactly the event name is the ideal; one that merely
  // contains it still identifies it, just less tightly.
  return eventInHeading && headingInEvent ? 1 : Math.max(overlap, 0.75);
}

export type WindowFailure = "NO_CONFIDENT_SECTION" | "AMBIGUOUS_SECTION" | "NO_SECTIONS";

export interface EventWindow {
  section: Section;
  html: string;
  score: number;
}

/**
 * The minimum score a heading needs. A heading that contains the whole event
 * name but a great deal else besides is not a confident identification.
 */
export const WINDOW_THRESHOLD = 0.5;

/**
 * Locate the single section documenting `eventName`, or explain why not.
 *
 * Returns a failure rather than a best guess whenever the answer is not
 * unambiguous — see the safety note at the top of the file.
 */
export function findEventWindow(
  html: string,
  eventName: string,
): { ok: true; window: EventWindow } | { ok: false; reason: WindowFailure; detail: string } {
  const { $, nodes, sections } = indexSections(html);
  if (!sections.length) return { ok: false, reason: "NO_SECTIONS", detail: "article has no headings" };

  const scored = sections
    .map((section) => ({ section, score: headingScore(eventName, section.heading) }))
    .filter((s) => s.score >= WINDOW_THRESHOLD)
    // Best score first; on a tie the SHALLOWER heading wins, because an `h2`
    // event section already contains its own `h3` subsections ("Background",
    // "Results") and is the window we want. Only a tie at the SAME depth is
    // genuine ambiguity.
    .sort((a, b) => b.score - a.score || a.section.level - b.section.level);

  if (!scored.length) {
    return { ok: false, reason: "NO_CONFIDENT_SECTION", detail: `no heading matches "${eventName}"` };
  }
  // A tie at equal depth is ambiguity, not a coin flip: the document names this
  // event twice at the same rank and nothing here can say which holds the card.
  if (
    scored.length > 1 &&
    scored[1].score === scored[0].score &&
    scored[1].section.level === scored[0].section.level
  ) {
    return {
      ok: false,
      reason: "AMBIGUOUS_SECTION",
      detail: `"${scored[0].section.heading}" and "${scored[1].section.heading}" match equally`,
    };
  }

  const best = scored[0];
  return { ok: true, window: { section: best.section, html: sectionHtml($, nodes, best.section), score: best.score } };
}
