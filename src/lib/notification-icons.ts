// ════════════════════════════════════════════════════════════════════════════
//  Notification iconography. PURE data — no JSX, so it is unit-testable and can
//  be imported by a server producer as well as the renderer.
//
//  ── WHY A KEY AND NOT AN EMOJI ────────────────────────────────────────────
//  Producers used to write an emoji straight into `Notification.icon` ("🏆",
//  "▶️", "✅"). Three problems, in increasing order of seriousness:
//
//    1. It looks nothing like the rest of the product — every other glyph in
//       GlobalFight is a Lucide stroke icon.
//    2. Emoji are rendered by the OS FONT, so the same notification looked like a
//       different product on Windows, macOS, Android and older Samsung devices —
//       and some glyphs (▶️) render as a monochrome box on Windows entirely.
//    3. They cannot inherit theme colour, so an unread row could not tint its own
//       icon.
//
//  Producers emit a SEMANTIC KEY now ("victory", "video"). The key survives a
//  redesign; an emoji is a design decision welded into a database row.
//
//  ── THE ROWS ALREADY IN THE DATABASE ──────────────────────────────────────
//  Production has months of notifications carrying emoji, and there is no
//  migration here on purpose: rewriting historical rows to chase a visual change
//  is a risky UPDATE across the largest table in the app for zero user benefit.
//  So LEGACY_EMOJI maps every emoji that was ever produced onto the same keys,
//  and old rows render as icons too. The map is append-only history — do not add
//  to it, add a key instead.
// ════════════════════════════════════════════════════════════════════════════

/**
 * Every icon a notification may carry. Adding one is a line here plus a line in
 * the renderer's ICONS map — the compiler enforces the pair.
 */
export const NOTIFICATION_ICON_KEYS = [
  "victory", "defeat", "correct", "missed",
  "fight", "cancelled", "rescheduled", "scheduled", "live", "results",
  "ranking", "rankingUp", "rankingDown",
  "gym", "review", "edit", "removed",
  "community", "reply", "mention", "person", "follow", "verified",
  "announcement", "promotion", "video", "news", "podcast",
  "streak", "card", "reputation", "milestone", "welcome",
  "bell",
] as const;

export type NotificationIconKey = (typeof NOTIFICATION_ICON_KEYS)[number];

const KEY_SET = new Set<string>(NOTIFICATION_ICON_KEYS);

/**
 * Emoji that were written into `Notification.icon` before this module existed.
 *
 * Historical compatibility ONLY. Every entry corresponds to a producer that has
 * since been converted to a key.
 */
const LEGACY_EMOJI: Record<string, NotificationIconKey> = {
  "🏆": "victory",
  "✅": "correct",
  "❌": "missed",
  "@": "mention",
  "🥊": "fight",
  "🚫": "cancelled",
  "🗓️": "rescheduled",
  "📅": "scheduled",
  "🔴": "live",
  "📋": "results",
  "📈": "rankingUp",
  "⬆️": "rankingUp",
  "⬇️": "rankingDown",
  "⭐": "review",
  "✏️": "edit",
  "🗑️": "removed",
  "💬": "reply",
  "👤": "person",
  "🤝": "community",
  "📣": "announcement",
  "▶️": "video",
  "📰": "news",
  "🎙️": "podcast",
  "🔥": "streak",
  "🃏": "card",
  "🏅": "milestone",
  "🏁": "results",
  "👋": "welcome",
  "📝": "edit",
  "❝": "reply",
  "➕": "fight",
  "⏸️": "cancelled",
  "🔔": "bell",
  "⏳": "scheduled",
  "⏰": "scheduled",
  "📊": "results",
};

/**
 * Fallback by notification TYPE, for a row whose icon is null or unrecognised.
 *
 * This is the safety net that guarantees every row renders SOMETHING meaningful
 * rather than a generic bell — including any row written by a producer that
 * forgets to pass an icon.
 */
const BY_TYPE: Record<string, NotificationIconKey> = {
  // ── FeedKind (lib/following) ─────────────────────────────────────────────
  // The Following feed draws through the same resolver, and its `kind` values are
  // feed-specific rather than NotificationTypes. Mapped here so an item with no
  // icon degrades to something meaningful instead of a generic bell — the feed
  // reads historical Notification rows whose icon may be null.
  event_upcoming: "scheduled",
  fighter: "fight",
  result: "results",
  personal: "victory",
  coverage: "news",
  video: "video",

  // ── NotificationType ────────────────────────────────────────────────────
  PICK_RESULT: "correct",
  CARD_EARNED: "card",
  REP_MILESTONE: "reputation",
  FIGHT_ANNOUNCED: "fight",
  EVENT_LIVE: "live",
  FOLLOW: "follow",
  COMMUNITY_REPLY: "reply",
  BATTLE_RESULT: "victory",
  BATTLE_MATCHED: "community",
  BATTLE_REPLY: "reply",
  STREAK_REMINDER: "streak",
  GYM_REVIEW: "review",
  SYSTEM: "announcement",
};

/**
 * Resolve a stored notification to an icon key.
 *
 * Order: an explicit key, then a legacy emoji, then the type, then a bell. Never
 * throws and never returns null — a notification with no icon is a broken row in
 * the UI, and the list must not have holes in it.
 */
export function notificationIconKey(n: {
  icon?: string | null;
  type?: string | null;
}): NotificationIconKey {
  const raw = n.icon?.trim();
  if (raw) {
    if (KEY_SET.has(raw)) return raw as NotificationIconKey;
    const legacy = LEGACY_EMOJI[raw];
    if (legacy) return legacy;
  }
  return (n.type && BY_TYPE[n.type]) || "bell";
}

/**
 * Icons that read as GOOD news, so a row can tint itself.
 *
 * Colour is not the only signal — the icon shape differs too — so a reader who
 * cannot distinguish the tint still gets the meaning.
 */
const POSITIVE = new Set<NotificationIconKey>([
  "victory", "correct", "rankingUp", "verified", "streak", "card", "reputation", "milestone",
]);
const NEGATIVE = new Set<NotificationIconKey>(["defeat", "missed", "cancelled", "rankingDown", "removed"]);

export type IconTone = "positive" | "negative" | "neutral";

export function iconTone(key: NotificationIconKey): IconTone {
  if (POSITIVE.has(key)) return "positive";
  if (NEGATIVE.has(key)) return "negative";
  return "neutral";
}
