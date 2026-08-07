// ════════════════════════════════════════════════════════════════════════════
//  The @mention grammar — ONE definition, shared by the renderer, the notifier
//  and the composer's autocomplete.
//
//  The forum has highlighted @names since Phase 4 and the reply composer
//  pre-fills one, so the product has been promising a mention and delivering
//  nothing. Fixing that with a second regex over here would be worse than the
//  bug: highlight and notify would drift, and the failure mode is silent —
//  a name styled as a mention that never reached anyone.
//
//  The autocomplete below is the third consumer and the same argument applies
//  to it with a new edge: a picker built on a WIDER alphabet would happily
//  complete "@bob.smith", and the renderer would then highlight only "@bob"
//  while the notifier pinged a user who does not exist. So the in-progress
//  token uses MENTION_CHARS too, and the only difference is the minimum length
//  — a bare "@" is a real state while typing (it opens the picker showing the
//  people you follow) and is not a mention once written.
//
//  Client- and server-safe: no prisma, no env.
// ════════════════════════════════════════════════════════════════════════════

/** Usernames are [a-zA-Z0-9_], 2–30 — the signup validator's alphabet. */
const MENTION_CHARS = "a-zA-Z0-9_";
const MENTION = `@[${MENTION_CHARS}]{2,30}`;

/** Tokeniser for RichText.split(): mentions and bare URLs. */
export const RICH_TEXT_TOKEN = new RegExp(`(${MENTION}|https?:\\/\\/[^\\s<]+)`, "g");

/**
 * Distinct, lower-cased usernames mentioned in a body.
 *
 * Capped, because "notify everyone I can name" is the cheapest spam vector in
 * any forum — one post must not be able to ping a hundred people. Beyond the
 * cap the names still highlight; they just don't buy a notification.
 */
export function extractMentions(text: string, limit = 10): string[] {
  const found = new Set<string>();
  for (const m of text.matchAll(new RegExp(MENTION, "g"))) {
    found.add(m[0].slice(1).toLowerCase());
    if (found.size >= limit) break;
  }
  return [...found];
}

// ── Autocomplete ────────────────────────────────────────────────────────────
//  Where does the @handle being typed start and end?
//
//  Pure, and separate from the Composer component, because this is the part with the
//  edge cases — everything else in that component is a fetch and a list. The
//  interesting question is not "does @dav match" but all the places it must NOT
//  fire: inside an email address, in the middle of a handle the reader has
//  already finished, or after they have typed the space that ends it.

/**
 * A handle in progress, immediately before the caret.
 *
 * Anchored to the caret with `$`, which is what makes the menu close by itself:
 * once a space (or anything else outside the handle charset) follows the
 * handle, the pattern stops matching and no state has to be cleared.
 *
 * The leading `(?:^|[\s(])` is the guard against email addresses. Without it
 * "mail me at bob@gma" opens a people picker on "gma" — the "@" has to begin a
 * word, not merely appear somewhere.
 *
 * `{0,30}` and not `{2,30}`: a bare "@" with nothing after it is a valid, useful
 * state while TYPING. It is what opens the picker showing the people you
 * follow, before a single character of the name has been entered. The written
 * result is still held to the 2–30 rule, because the handle is inserted from a
 * server row rather than from what was typed.
 */
const IN_PROGRESS = new RegExp(`(?:^|[\\s(])@([${MENTION_CHARS}]{0,30})$`);

export interface MentionToken {
  /** The handle fragment typed so far, without the "@". May be empty. */
  text: string;
  /** Index of the "@" in the full text. */
  start: number;
  /** Index just past the fragment — i.e. the caret. */
  end: number;
}

/**
 * Read the in-progress mention at `caret`, or null if there is not one.
 *
 * `caret` is the CARET, not the end of the string: someone editing a mention in
 * the middle of a sentence must complete against the text to their left only.
 */
export function readMentionToken(text: string, caret: number): MentionToken | null {
  const at = Math.max(0, Math.min(caret, text.length));
  const match = IN_PROGRESS.exec(text.slice(0, at));
  if (!match) return null;
  return { text: match[1], start: at - match[1].length - 1, end: at };
}

/**
 * Replace the token with a complete handle, and say where the caret goes.
 *
 * The trailing space is functional, not cosmetic: it is what stops IN_PROGRESS
 * matching, which is what closes the menu.
 */
export function applyMention(
  text: string,
  token: MentionToken,
  username: string,
): { text: string; caret: number } {
  const insert = `@${username} `;
  return {
    text: text.slice(0, token.start) + insert + text.slice(token.end),
    caret: token.start + insert.length,
  };
}
