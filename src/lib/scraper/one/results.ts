import * as cheerio from "cheerio";
import type { Element } from "domhandler";

// ════════════════════════════════════════════════════════════════════════════
//  ONE Championship — official LIVE RESULTS parser.
//
//  Built against a real captured page, not against guessed markup:
//  __fixtures__/fight-night-45.html, from
//  onefc.com/news/one-fight-night-45-lessei-vs-rabah-results-…
//
//  ── Why this connector matters most ──────────────────────────────────────
//  audit:quality measured 251 ONE events with NO BOUTS AT ALL — the single
//  largest coverage gap in the database, several times any other promotion's.
//  ONE renders results client-side on its event pages, which is why the existing
//  pipeline could never read them; these editorial "results and highlights"
//  articles are server-rendered and carry the whole card.
//
//  ── The shape, verbatim from the page ────────────────────────────────────
//      <h2 class="mt-5">Fight Card</h2>
//      <h5>Featherweight Muay Thai</h5>
//      <a href="/athletes/luke-lessei/">Luke “The Chef” Lessei</a>
//        defeats
//      <a href="/athletes/mohamed-younes-rabah/">“The Eagle” Mohamed Younes Rabah</a>
//        via knockout at 1:39 of round two
//
//  Three things that make this a GOOD source rather than merely a readable one:
//
//   1. The athlete anchors carry a stable slug. That is an EXTERNAL ID, and the
//      identity resolver's strongest rung — so a ONE bout resolves its corners
//      by id rather than by name, permanently, from the first import.
//   2. The h5 carries the ruleset ("Muay Thai", "MMA", "Kickboxing") alongside
//      the division. ONE runs mixed cards, and the event-level sport is wrong for
//      most of them — this is per-bout truth.
//   3. Finishes carry the round and the time.
//
//  PURE — no I/O, no Prisma. Parsing and fetching are separate so the parser can
//  be tested against the fixture with no network.
// ════════════════════════════════════════════════════════════════════════════

export interface OneBout {
  /** Winner's display name, nickname stripped. */
  redName: string;
  blueName: string;
  /** ONE athlete slug — a stable external id. Null when the page linked no profile. */
  redExternalId: string | null;
  blueExternalId: string | null;
  /** Nicknames as published, when the page carried them. */
  redNickname: string | null;
  blueNickname: string | null;
  /** "Featherweight" — the division, ruleset removed. */
  weightClass: string | null;
  /** "MUAY_THAI" | "MMA" | "KICKBOXING" | "SUBMISSION_GRAPPLING" — per BOUT. */
  ruleset: string | null;
  /** "unanimous decision", "knockout", "submission"… as published. */
  method: string | null;
  round: number | null;
  /** "1:39" as published. */
  time: string | null;
  /** WIN | DRAW | NO_CONTEST. */
  result: "WIN" | "DRAW" | "NO_CONTEST";
  /** Position on the card as published, 0 = first listed (the main event). */
  order: number;
}

/** ONE's ruleset words → the app's Ruleset vocabulary. */
const RULESETS: [RegExp, string][] = [
  [/\bmuay\s*thai\b/i, "MUAY_THAI"],
  [/\bkickboxing\b/i, "KICKBOXING"],
  [/\bsubmission\s*grappling\b/i, "SUBMISSION_GRAPPLING"],
  [/\bmma\b/i, "MMA"],
];

/** Written-out round numbers, as the page publishes them. */
const ROUND_WORDS: Record<string, number> = {
  one: 1, two: 2, three: 3, four: 4, five: 5,
};

/**
 * Elements that end a bout's text.
 *
 * The next division heading, a rule between bouts, or the end of the article
 * body. Without the last group the final bout on every card absorbs the page
 * chrome — see the note in the walk below.
 */
const BOUNDARY = new Set(["h1", "h2", "h3", "h4", "h5", "h6", "hr", "footer", "aside", "section", "nav"]);

/**
 * A published method is a few words. Anything longer is page furniture that
 * leaked past the boundary check, and truncating is better than storing it —
 * but the boundary check is the real fix, and this is the belt to its braces.
 */
const MAX_METHOD_CHARS = 60;

/**
 * Split "Featherweight Muay Thai" into a division and a ruleset.
 *
 * The ruleset is stripped from the division deliberately. ONE's divisions are
 * "Featherweight" — the discipline is a property of the BOUT, and leaving it in
 * the name would create a separate WeightClass row per discipline (WeightClass
 * resolves by `(sport, name)`), splitting one division into four.
 */
export function splitDivision(heading: string): { weightClass: string | null; ruleset: string | null } {
  const text = heading.replace(/\s+/g, " ").trim();
  if (!text) return { weightClass: null, ruleset: null };

  for (const [re, ruleset] of RULESETS) {
    if (re.test(text)) {
      const weightClass = text.replace(re, "").replace(/\s+/g, " ").trim();
      return { weightClass: weightClass || null, ruleset };
    }
  }
  return { weightClass: text, ruleset: null };
}

/**
 * Pull the nickname out of a published name.
 *
 * ONE writes them in CURLY quotes, and in either position: `Luke “The Chef”
 * Lessei` and `“The Eagle” Mohamed Younes Rabah` both occur on the same card.
 * Straight quotes are accepted too — the same article can carry either
 * depending on how it was typed.
 */
export function splitNickname(raw: string): { name: string; nickname: string | null } {
  const text = raw.replace(/\s+/g, " ").trim();
  const m = text.match(/[“"]([^”"]+)[”"]/);
  if (!m) return { name: text, nickname: null };
  const name = text.replace(m[0], "").replace(/\s+/g, " ").trim();
  // A name that is ONLY a nickname keeps it as the name — "Black Panther"
  // competes under exactly that, and returning an empty name would drop them.
  return name ? { name, nickname: m[1].trim() } : { name: text.replace(/[“”"]/g, "").trim(), nickname: null };
}

/** The athlete slug out of a ONE profile URL. */
export function athleteSlug(href: string | undefined): string | null {
  if (!href) return null;
  const m = href.match(/\/athletes\/([^/?#]+)/i);
  return m ? m[1].toLowerCase() : null;
}

/**
 * Parse the outcome clause: "via knockout at 1:39 of round two".
 *
 * Everything after `via` up to the round/time is the method AS PUBLISHED — not
 * mapped to an enum here. Normalising a method is a decision for the ingest
 * layer, and keeping the source's own words means a method we have not seen
 * before survives the parse instead of becoming "OTHER".
 */
export function parseOutcome(tail: string): Pick<OneBout, "method" | "round" | "time" | "result"> {
  const text = tail.replace(/\s+/g, " ").trim();

  if (/\bno\s*contest\b/i.test(text)) return { method: "no contest", round: null, time: null, result: "NO_CONTEST" };
  if (/\bdraw\b/i.test(text)) return { method: "draw", round: null, time: null, result: "DRAW" };

  const via = text.match(/\bvia\s+(.+)$/i);
  if (!via) return { method: null, round: null, time: null, result: "WIN" };

  let rest = via[1].trim();
  let time: string | null = null;
  let round: number | null = null;

  const at = rest.match(/\bat\s+(\d{1,2}:\d{2})\b/i);
  if (at) { time = at[1]; rest = rest.replace(at[0], " "); }

  const roundMatch = rest.match(/\bround\s+(\d+|one|two|three|four|five)\b/i);
  if (roundMatch) {
    const token = roundMatch[1].toLowerCase();
    round = ROUND_WORDS[token] ?? Number.parseInt(token, 10);
    if (!Number.isFinite(round)) round = null;
    rest = rest.replace(roundMatch[0], " ");
  }

  let method = rest.replace(/\bof\b/gi, " ").replace(/[.,]/g, " ").replace(/\s+/g, " ").trim();
  // Second line of defence. If page chrome ever leaks past the boundary check,
  // store a truncated method rather than a paragraph of navigation.
  if (method.length > MAX_METHOD_CHARS) method = method.slice(0, MAX_METHOD_CHARS).trim();
  return { method: method || null, round, time, result: "WIN" };
}

/**
 * Parse a ONE "results and highlights" article into bouts.
 *
 * Anchored on the `Fight Card` heading rather than scanning the whole document:
 * these articles quote earlier results in their prose, and a document-wide scan
 * for "defeats" would import last month's card into this month's event.
 */
export function parseOneResults(html: string): OneBout[] {
  const $ = cheerio.load(html);
  const bouts: OneBout[] = [];

  // Every h5 in the article body is a division heading; the bout sentence is the
  // text that follows it, up to the next h5.
  $("h5").each((_, h5) => {
    const heading = $(h5).text().replace(/\s+/g, " ").trim();
    if (!heading) return;

    // Walk forward collecting the anchors and text that belong to THIS bout.
    const anchors: Element[] = [];
    const parts: string[] = [];
    let node = $(h5)[0].nextSibling;
    while (node) {
      const el = node as Element;
      const tag = (el.tagName ?? el.name)?.toLowerCase();
      // Stop at the next bout OR at any section boundary.
      //
      // `h5` alone was not enough, and the fixture proved it: the LAST bout on a
      // card has no following h5, so the walk ran on through the page and its
      // method came out as "unanimous decision Featured Liu Mengyang … Buy
      // Tickets STAY IN THE KNOW". Every bout but the last looked perfect, which
      // is exactly the kind of defect that ships.
      if (tag && BOUNDARY.has(tag)) break;
      if (tag) {
        const $el = $(el);
        $el.find("a[href*='/athletes/']").each((__, a) => { anchors.push(a as Element); });
        if ((el.tagName ?? el.name) === "a" && ($el.attr("href") ?? "").includes("/athletes/")) {
          anchors.push(el);
        }
        // Embeds carry their own link text ("View Highlights"); exclude them.
        parts.push($el.clone().find("blockquote, template, script, .smart-link").remove().end().text());
      } else {
        parts.push($(el).text());
      }
      node = el.nextSibling;
    }

    const sentence = parts.join(" ").replace(/\s+/g, " ").trim();
    if (!/\b(defeats|def\.|draw|no contest)\b/i.test(sentence)) return;
    if (anchors.length < 2) return;

    const red = splitNickname($(anchors[0]).text());
    const blue = splitNickname($(anchors[1]).text());
    const { weightClass, ruleset } = splitDivision(heading);

    // The outcome clause is whatever follows the SECOND athlete's name.
    const blueRaw = $(anchors[1]).text().replace(/\s+/g, " ").trim();
    const idx = sentence.indexOf(blueRaw);
    const tail = idx === -1 ? sentence : sentence.slice(idx + blueRaw.length);

    bouts.push({
      redName: red.name,
      blueName: blue.name,
      redExternalId: athleteSlug($(anchors[0]).attr("href")),
      blueExternalId: athleteSlug($(anchors[1]).attr("href")),
      redNickname: red.nickname,
      blueNickname: blue.nickname,
      weightClass,
      ruleset,
      ...parseOutcome(tail),
      order: bouts.length,
    });
  });

  return bouts;
}

/**
 * Refuse a broken parse. Same contract as the UFC and WBA connectors.
 *
 * A ONE card is never one bout. If a redesign leaves this returning two, the
 * correct outcome is a recorded failure and NOTHING written — not an event whose
 * card is silently 20% complete, which is indistinguishable from a real short
 * card and far harder to notice than an empty one.
 */
export function validateOneResults(bouts: OneBout[], minBouts = 4): void {
  if (bouts.length < minBouts) {
    throw new Error(`ONE parse produced only ${bouts.length} bouts (< ${minBouts}) — refusing to publish a partial card`);
  }
  const unnamed = bouts.filter((b) => !b.redName || !b.blueName);
  if (unnamed.length) {
    throw new Error(`ONE parse: ${unnamed.length} bout(s) missing a corner name — refusing to publish`);
  }
  // A card where nobody was linked means the anchors moved; names alone would
  // then be the only identity signal, which is the thing this source is good at
  // avoiding.
  if (!bouts.some((b) => b.redExternalId && b.blueExternalId)) {
    throw new Error("ONE parse: no athlete profile links found — refusing to publish name-only bouts");
  }
}
