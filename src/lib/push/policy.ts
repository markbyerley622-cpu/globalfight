// ════════════════════════════════════════════════════════════════════════════
//  Which notifications may be PUSHED to a given user, right now.
//
//  Client- and server-safe (no prisma, no env): the preferences UI and the
//  delivery path score against the same table, so what a user is shown in
//  settings is exactly what governs delivery. A second copy of this mapping is
//  how "I turned that off and still got it" happens.
// ════════════════════════════════════════════════════════════════════════════

export type NotifCategory = "fights" | "predictions" | "social" | "gym";

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
  SYSTEM: "social",
};

export const CATEGORIES: { id: NotifCategory; label: string; help: string }[] = [
  { id: "fights", label: "Fights & events", help: "Cards you follow starting, going live, or changing." },
  { id: "predictions", label: "Predictions", help: "Pick deadlines, results, and rank movement." },
  { id: "social", label: "Replies & follows", help: "Replies to you, battles, and new followers." },
  { id: "gym", label: "Your gym", help: "Check-ins, membership and verification." },
];

export interface NotifPrefs {
  notifyFights: boolean;
  notifyPredictions: boolean;
  notifySocial: boolean;
  notifyGym: boolean;
  quietHoursStart: number | null;
  quietHoursEnd: number | null;
  timezone: string | null;
}

const ENABLED: Record<NotifCategory, keyof NotifPrefs> = {
  fights: "notifyFights",
  predictions: "notifyPredictions",
  social: "notifySocial",
  gym: "notifyGym",
};

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
