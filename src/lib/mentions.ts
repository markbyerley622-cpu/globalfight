// ════════════════════════════════════════════════════════════════════════════
//  The @mention grammar — ONE definition, shared by the renderer and the
//  notifier.
//
//  The forum has highlighted @names since Phase 4 and the reply composer
//  pre-fills one, so the product has been promising a mention and delivering
//  nothing. Fixing that with a second regex over here would be worse than the
//  bug: highlight and notify would drift, and the failure mode is silent —
//  a name styled as a mention that never reached anyone.
//
//  Client- and server-safe: no prisma, no env.
// ════════════════════════════════════════════════════════════════════════════

/** Usernames are [a-zA-Z0-9_], 2–30 — the signup validator's alphabet. */
const MENTION = "@[a-zA-Z0-9_]{2,30}";

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
