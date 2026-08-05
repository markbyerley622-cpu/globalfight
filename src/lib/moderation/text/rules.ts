import { normalize, collapsed, tokens } from "./normalize";
import { RACIAL, HOMOPHOBIC, ABLEIST, INNOCENT_SUBSTRINGS, EXEMPT_PHRASES } from "./terms";

// ════════════════════════════════════════════════════════════════════════════
//  THE RULE REGISTRY.
//
//  Every moderation decision in the product comes from this array. Rules are
//  data, not code scattered across endpoints: adding a category, tuning a
//  threshold or wiring an AI classifier is an entry here, and no comment
//  endpoint changes.
//
//  A rule is deliberately tiny — an id, a category, a matcher and the sentence
//  the user sees. That shape is what makes the later work (moderator review,
//  appeals, per-category severities, remote keyword updates) additive: each of
//  those hangs off `id` and `category` without the matcher needing to know.
// ════════════════════════════════════════════════════════════════════════════

export type ModerationCategory =
  | "hate_speech"
  | "harassment"
  | "self_harm"
  | "spam";

export interface ModerationContext {
  /** Exactly what the user typed. Never mutated. */
  raw: string;
  /** Lower-cased, accent-stripped, leet-folded. Word boundaries intact. */
  normalized: string;
  /** As above with every separator removed — defeats "n i g g e r". */
  collapsed: string;
  /** Word-boundary tokens of `normalized`. */
  tokens: string[];
}

export interface ModerationRule {
  /** Stable identifier. Stored on a block so decisions stay auditable. */
  id: string;
  category: ModerationCategory;
  /** The sentence shown to the author. Specific enough to act on, never a lecture. */
  message: string;
  /** True when the content violates this rule. */
  test: (ctx: ModerationContext) => boolean;
}

export function buildContext(raw: string): ModerationContext {
  const normalized = normalize(raw);
  return { raw, normalized, collapsed: collapsed(raw), tokens: tokens(raw) };
}

/**
 * Does a deny-listed term appear as a WORD (not a substring of a longer word)?
 *
 * Two passes, because each catches what the other cannot:
 *   1. token equality / suffixed form — exact, boundary-safe, zero false
 *      positives. Catches "nigger", "niggers", "faggots".
 *   2. collapsed substring — catches the spaced and punctuated evasions
 *      ("n.i.g.g.e.r"), but has no boundaries, so it is gated behind the
 *      innocent-substring allow-list.
 */
function hasTerm(ctx: ModerationContext, terms: string[]): boolean {
  // Contextual exemptions win outright — see EXEMPT_PHRASES.
  if (EXEMPT_PHRASES.some((re) => re.test(ctx.normalized))) return false;

  for (const term of terms) {
    // Pass 1 — real word boundaries. A plural or possessive still counts.
    if (ctx.tokens.some((t) => t === term || t === `${term}s` || t === `${term}es`)) return true;
  }

  // Pass 2 — evasion. Only consulted when the text contains no innocent word
  // that would explain the hit, because collapsing destroys boundaries.
  const innocent = INNOCENT_SUBSTRINGS.some((w) => ctx.normalized.includes(w));
  if (innocent) return false;
  return terms.some((term) => ctx.collapsed.includes(term));
}

/**
 * URLs and mentions, for the spam heuristics.
 *
 * COUNTING forms are global; the PRESENCE form deliberately is not. `.test()` on
 * a /g regex advances `lastIndex` and keeps it between calls, so a shared
 * module-level global regex returns true, false, true, false… for the same
 * input. That is exactly what happened here: the threat rule silently stopped
 * firing on every second call. Counting via `String.match` is unaffected, which
 * is why only the presence check needed its own non-global copy.
 */
const URL_RE = /https?:\/\/|www\.[a-z0-9-]+\.[a-z]{2,}/gi;
const MENTION_RE = /@[a-z0-9_]{2,}/gi;
const HAS_MENTION = /@[a-z0-9_]{2,}/i;

export const RULES: ModerationRule[] = [
  // ── Hate speech ─────────────────────────────────────────────────────────
  {
    id: "hate.racial_slur",
    category: "hate_speech",
    message: "That post contains a racial or ethnic slur. Say it another way and it'll go straight through — swearing is fine here, slurs aren't.",
    test: (c) => hasTerm(c, RACIAL),
  },
  {
    id: "hate.homophobic_slur",
    category: "hate_speech",
    message: "That post contains a slur targeting sexuality or gender identity. Rewrite it and post again — swearing is fine here, slurs aren't.",
    test: (c) => hasTerm(c, HOMOPHOBIC),
  },
  {
    id: "hate.ableist_slur",
    category: "hate_speech",
    message: "That post contains a slur targeting disability. Rewrite it and post again — swearing is fine here, slurs aren't.",
    test: (c) => hasTerm(c, ABLEIST),
  },
  {
    /**
     * Incitement TEMPLATES rather than words: "<group> should all be <killed>".
     *
     * Structural, because hate speech does not require a slur — and because a
     * word list can never express "targeting a protected attribute". The group
     * term is matched loosely; the VIOLENT INTENT half is what makes it a hit,
     * which is why ordinary fight talk ("he should get knocked out") cannot
     * trigger it.
     */
    id: "hate.incitement",
    category: "hate_speech",
    message: "That reads as targeting a group of people rather than talking about the fight. We don't publish that here.",
    test: (c) =>
      /\b(all|every|these|those|the)\s+(muslims?|jews?|blacks?|whites?|asians?|arabs?|mexicans?|immigrants?|gays?|lesbians?|trans(gender)?(\s+people)?|women|men)\b[^.!?]{0,40}\b(should|needs? to|deserves? to|must|ought to)\b[^.!?]{0,20}\b(die|be killed|be shot|be gassed|be hanged|hang|be deported|be wiped out|be exterminated)\b/.test(c.normalized) ||
      /\b(gas|kill|exterminate|lynch)\s+(all|the)\s+(muslims?|jews?|blacks?|whites?|asians?|arabs?|mexicans?|immigrants?|gays?)\b/.test(c.normalized),
  },

  // ── Self-harm incitement ────────────────────────────────────────────────
  {
    /**
     * "kill yourself" / "kys" — the one violence phrase that is unambiguous.
     *
     * Deliberately NARROW. "Kill him", "knock him out", "finish him", "he
     * should get destroyed" are all normal, correct combat-sports language and
     * must pass untouched. What is blocked is telling a PERSON to end their own
     * life, which has no reading as fight commentary.
     */
    id: "harassment.self_harm",
    category: "self_harm",
    message: "Telling someone to harm themselves isn't allowed here. Everything else about the fight is fair game.",
    test: (c) =>
      /\bk\s*y\s*s\b/.test(c.normalized) ||
      /\b(kill|hang|neck)\s+(your\s*self|urself|yourself)\b/.test(c.normalized) ||
      /\bgo\s+die\b/.test(c.normalized),
  },

  // ── Targeted harassment ─────────────────────────────────────────────────
  {
    /**
     * A REAL-WORLD threat aimed at a named user, not a fighter.
     *
     * Requires an @mention plus a physical-world locator ("find you", "know
     * where you live"). Without the locator this would swallow "@dave I'll
     * knock you out", which is banter about a video game's worth of violence
     * and completely normal on a fight board.
     */
    id: "harassment.threat",
    category: "harassment",
    message: "That reads as a real-world threat against another member. Keep it about the fight.",
    test: (c) =>
      // The mention is read from RAW, the threat from NORMALIZED, and the split
      // is load-bearing. Normalisation leet-folds "@" to "a" — that is what
      // makes "@ss" match — so "@dave" becomes "adave" and no mention pattern
      // can ever match the normalised form. Structural features (mentions,
      // URLs) belong to the raw text; only TERMS get normalised.
      HAS_MENTION.test(c.raw) &&
      /\b(find|come to|show up at|turn up at)\s+(you|your)\b|\bi know where you (live|work)\b|\byour address\b/.test(c.normalized),
  },

  // ── Spam ────────────────────────────────────────────────────────────────
  {
    id: "spam.links",
    category: "spam",
    message: "That's a lot of links for one post. Trim it down and try again.",
    test: (c) => (c.raw.match(URL_RE) ?? []).length > 3,
  },
  {
    id: "spam.mentions",
    category: "spam",
    message: "Too many people mentioned in one post. Mention the few who actually need to see it.",
    test: (c) => (c.raw.match(MENTION_RE) ?? []).length > 8,
  },
  {
    /**
     * Character flooding: "AAAAAAAAAAAAAAAAAAAA".
     *
     * The threshold is 25 because fight boards legitimately shout —
     * "LETSGOOOOOO" and "OOOOOHHHH" are the correct reaction to a knockout and
     * must survive. This only catches a run long enough to be a wall.
     */
    id: "spam.flood",
    category: "spam",
    message: "That looks like keyboard mashing. Try again with something readable.",
    test: (c) => /(.)\1{24,}/.test(c.raw),
  },
];
