// ════════════════════════════════════════════════════════════════════════════
//  Which notifications may be PUSHED to a given user, right now.
//
//  Client- and server-safe (no prisma, no env): the preferences UI and the
//  delivery path score against the same table, so what a user is shown in
//  settings is exactly what governs delivery. A second copy of this mapping is
//  how "I turned that off and still got it" happens.
// ════════════════════════════════════════════════════════════════════════════

export type NotifCategory = "fights" | "predictions" | "social" | "gym" | "messages";

/**
 * NotificationType → category.
 *
 * Users think in categories ("stop telling me about fights"), not in enum
 * members. Mapping here means a new NotificationType needs one line, never a
 * migration and never a new toggle.
 */
export const CATEGORY_OF: Record<string, NotifCategory> = {
  FIGHT_ANNOUNCED: "fights",
  EVENT_LIVE: "fights",
  PICK_RESULT: "predictions",
  REP_MILESTONE: "predictions",
  CARD_EARNED: "predictions",
  BATTLE_RESULT: "predictions",
  BATTLE_MATCHED: "social",
  BATTLE_REPLY: "social",
  COMMUNITY_REPLY: "social",
  FOLLOW: "social",
  // Was missing, and the default is "social" — so a gym review's PUSH was gated by
  // the replies toggle while its in-app row was gated by the gym toggle. Two
  // switches for one notification, and neither one did what it said.
  GYM_REVIEW: "gym",
  // Gym posts ride the "gym" toggle, not "social". Someone who muted their gym
  // expects that to cover the gym's feed; routing replies-under-a-gym-post
  // through the replies toggle would be the same two-switches-for-one-thing bug
  // GYM_REVIEW is sitting here to document.
  GYM_POST_REPLY: "gym",
  GYM_POST_REACTION: "gym",
  GYM_POST_SHARE: "gym",
  // A streak is earned by predicting and lives in the same habit loop as rank
  // and results, so it rides the "predictions" toggle rather than adding a fifth
  // category (and a migration). A user who muted predictions muting this too is
  // coherent.
  STREAK_REMINDER: "predictions",
  // A DM is addressed to YOU by a person, which is a different promise from
  // "someone replied in a thread you are in". Its own switch, for the same
  // reason GYM_REVIEW above has one: a user who mutes replies has not said
  // anything about whether they want to hear from their friends.
  DIRECT_MESSAGE: "messages",
  SYSTEM: "social",
};

export const CATEGORIES: { id: NotifCategory; label: string; help: string }[] = [
  { id: "fights", label: "Fights & events", help: "Cards you follow starting, going live, or changing." },
  { id: "predictions", label: "Predictions", help: "Pick deadlines, results, and rank movement." },
  { id: "social", label: "Replies & follows", help: "Replies to you, battles, and new followers." },
  { id: "gym", label: "Your gym", help: "Check-ins, membership and verification." },
  { id: "messages", label: "Direct messages", help: "Private messages sent to you." },
];

export interface NotifPrefs {
  notifyFights: boolean;
  notifyPredictions: boolean;
  notifySocial: boolean;
  notifyGym: boolean;
  notifyMessages: boolean;
  quietHoursStart: number | null;
  quietHoursEnd: number | null;
  timezone: string | null;
}

/**
 * Category → the User column that switches it off.
 *
 * EXPORTED because lib/follow-targets kept a second copy of this map for its
 * own preference filter, and the two had to be edited together — which is
 * exactly the "second copy of this mapping is how 'I turned that off and still
 * got it' happens" failure this module's header warns about. It was already
 * happening: adding a category here left the other map a compile error away
 * from silently governing delivery by a stale table.
 */
export const PREF_COLUMN: Record<NotifCategory, keyof NotifPrefs> = {
  fights: "notifyFights",
  predictions: "notifyPredictions",
  social: "notifySocial",
  gym: "notifyGym",
  messages: "notifyMessages",
};

const ENABLED = PREF_COLUMN;

/** The user's local hour, honouring their stored zone. */
export function localHour(tz: string | null, at: Date = new Date()): number {
  if (!tz) return at.getUTCHours();
  try {
    return Number(
      new Intl.DateTimeFormat("en-GB", { hour: "numeric", hour12: false, timeZone: tz }).format(at),
    );
  } catch {
    // An invalid zone must not silence someone's notifications entirely.
    return at.getUTCHours();
  }
}

/** True while the user has asked not to be disturbed. Handles windows that
 *  wrap midnight (22 → 7), which is the common case. */
export function inQuietHours(prefs: NotifPrefs, at: Date = new Date()): boolean {
  const { quietHoursStart: s, quietHoursEnd: e } = prefs;
  if (s === null || e === null || s === e) return false;
  const h = localHour(prefs.timezone, at);
  return s < e ? h >= s && h < e : h >= s || h < e;
}

/**
 * May this notification type be pushed to this user now?
 *
 * Quiet hours suppress the PUSH only. The in-app notification is still written,
 * so nothing is lost — the user simply finds it when they next open the app
 * rather than being woken by it.
 */
export function mayPush(type: string, prefs: NotifPrefs, at: Date = new Date()): boolean {
  const category = CATEGORY_OF[type] ?? "social";
  if (!prefs[ENABLED[category]]) return false;
  return !inQuietHours(prefs, at);
}
