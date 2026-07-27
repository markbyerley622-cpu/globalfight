// ════════════════════════════════════════════════════════════════════════════
//  What a user is called IN PUBLIC. One function, because getting it wrong is a
//  privacy incident rather than a cosmetic bug.
//
//  ── THE BUG THIS EXISTS TO KILL ───────────────────────────────────────────
//  Signup stores whatever was typed into the display-name field as `User.name`,
//  and people type their email address into it. Every public surface then read
//  `u.name ?? "@" + u.username` directly, so one account's full email was being
//  published in FOUR places at once:
//
//    • the share card image (/u/<username>/opengraph-image)
//    • the page <title> — so it reached search engines
//    • the meta description — so WhatsApp, iMessage and Slack previews carried it
//    • the visible profile heading
//
//  Sharing your own profile link broadcast your email to the group chat. That is
//  not something a per-page `.replace()` can be trusted to prevent, so the rule
//  lives here and every public surface calls it.
//
//  Client-safe on purpose (no prisma, no server-only): the same rule has to apply
//  in a React component and in an OG route, and a second copy of it is how one of
//  them starts leaking again.
// ════════════════════════════════════════════════════════════════════════════

/**
 * Anything that looks like an email address — deliberately BROADER than a
 * validator.
 *
 * A validator answers "could this be delivered to?", which is the wrong question.
 * The question here is "might a human read this as someone's email?", so a bare
 * `a@b` with no dot and a trailing-dot `a@b.` both count. False positives cost a
 * user a nickname and fall back to their handle; a false negative publishes their
 * inbox.
 */
const EMAIL_SHAPED = /\S+@\S+/;

export interface PublicNameSource {
  name?: string | null;
  username?: string | null;
}

/**
 * The name to show anywhere a stranger can see it.
 *
 * Precedence: a safe `name`, then `@username`, then a neutral placeholder — never
 * an email, and never an empty string (which renders as a blank heading and reads
 * as a broken page rather than a private one).
 */
export function publicDisplayName(user: PublicNameSource | null | undefined): string {
  const name = user?.name?.trim();
  if (name && !EMAIL_SHAPED.test(name)) return name;
  const username = user?.username?.trim();
  if (username) return `@${username}`;
  // No handle either. "Someone" is honest and leaks nothing; a raw id would leak
  // a database key into a share card.
  return "A predictor";
}

/**
 * Is this string safe to publish as a display name?
 *
 * Exported so the account form can tell someone "that looks like an email address"
 * at the point they type it, rather than silently overriding their choice later.
 */
export const isPublishableName = (value: string | null | undefined): boolean =>
  !!value?.trim() && !EMAIL_SHAPED.test(value);

/**
 * Up to two initials for an avatar fallback.
 *
 * Derived from the PUBLIC name, never the raw record — otherwise the fallback for
 * an email-named account rendered as the first characters of that email ("1g" for
 * markbyerley6221@gmail.com), which is both meaningless and a partial leak.
 */
export function initialsFor(user: PublicNameSource | null | undefined): string {
  const display = publicDisplayName(user).replace(/^@/, "");
  const words = display.split(/[\s._-]+/).filter(Boolean);
  if (words.length === 0) return "?";
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return (words[0][0] + words[1][0]).toUpperCase();
}
