import { presenceOf, lastSeenLabel, type PresenceState } from "./derive";

// ════════════════════════════════════════════════════════════════════════════
//  PRESENCE POLICY — the ONE place that answers "may this viewer see this?"
//
//  ── Why a policy layer and not a check at each call site ──────────────────
//  Presence is about to appear on a dozen surfaces: the DM inbox, a thread
//  header, profiles, follower lists, search results, comment authors. If each
//  one asks its own version of "should I show this?", then the day somebody
//  turns their presence off it goes dark on eleven of them and stays lit on the
//  twelfth — and nobody finds out, because the person it leaks about is the one
//  person who cannot see it.
//
//  That failure is silent and it is a privacy failure, which is the worst
//  combination. So no surface is allowed to read `lastSeenAt` and decide for
//  itself: they call `visiblePresence()` and render what comes back. The
//  privacy rule cannot be forgotten because there is nothing to remember.
//
//  ── Mutual by design, for the two that are about SOMEBODY ELSE ────────────
//  Typing and read receipts are not facts about you, they are facts about your
//  attention to another person — so they are reciprocal: switch yours off and
//  you stop seeing theirs. Without that, "hide my read receipts" is a one-way
//  mirror, and a feature that lets you watch people who cannot watch you back
//  is one people are right to resent.
//
//  Presence itself is NOT mutual: hiding whether you are around is a statement
//  about yourself and costs nobody else anything.
//
//  PURE. No prisma, no React, no Date.now() — testable at every boundary.
// ════════════════════════════════════════════════════════════════════════════

// ── Designed for richer ACTIVITY states, without changing this model ───────
//
// The intended next step is Discord-style activity — "Watching UFC Fight
// Night", "Making predictions", "Reviewing a gym" — rather than only a green
// dot. That is a strictly additive change to this module, and it is worth
// writing down exactly why, so the next person does not rebuild the core.
//
// What already generalises:
//   • The heartbeat is a TIMESTAMP with expiry, so an activity is the same
//     shape: a value plus a `lastSeenAt` that decays. An activity that gets
//     stuck is the same bug as an `isOnline` that gets stuck, and the same
//     mechanism prevents it.
//   • Every surface renders through `PresenceDot` / `PresenceLabel` and reads
//     from `PresenceDto`, so a richer label reaches ~every avatar in the app
//     the moment the DTO carries it. No surface needs editing.
//   • `visiblePresence` / `presenceDtoFor` are already the ONE privacy gate, so
//     an activity is filtered by the switch that already exists — nobody has to
//     remember that "Watching UFC 320" is more revealing than "online".
//
// What would change, and it is small:
//   1. Two columns on User: `activityKind` and `activityAt` (its own timestamp,
//      because an activity expires FASTER than presence — you stop watching
//      long before you go offline).
//   2. One field on `PresenceDto`, populated by `presenceDtoFor` and nulled by
//      the same `hidden` branch that already nulls `lastSeenAt`.
//   3. A third switch, `showActivity`, secondary to `showOnlineStatus` in
//      exactly the way `showLastSeen` already is.
//
// Deliberately NOT added yet: an unused column and an unpopulated field are a
// speculative shape that the real feature would probably contradict. The point
// here is that nothing above has to be undone to add it.

/** The four switches, exactly as stored on User. */
export interface PresencePrefs {
  showOnlineStatus: boolean;
  showLastSeen: boolean;
  allowTypingIndicator: boolean;
  allowReadReceipts: boolean;
}

/**
 * What a viewer is actually allowed to render.
 *
 * `hidden` is its own state rather than a null, because the UI needs to tell
 * "they have this switched off" apart from "we do not know yet" — the first is
 * a settled fact worth wording ("Presence hidden") and the second is a loading
 * state that must not be worded at all.
 */
export type VisiblePresence =
  | { visible: true; state: PresenceState; label: string | null }
  | { visible: false; state: "hidden"; label: null };

const HIDDEN: VisiblePresence = { visible: false, state: "hidden", label: null };

/** Everything on, for callers that have no prefs row (a deleted user, a stub). */
export const PRESENCE_PREFS_DEFAULT: PresencePrefs = {
  showOnlineStatus: true,
  showLastSeen: true,
  allowTypingIndicator: true,
  allowReadReceipts: true,
};

export interface VisiblePresenceInput {
  /** The person being looked AT. Null prefs = treat as default-on. */
  subject: { prefs: PresencePrefs | null; lastSeenAt: string | Date | null | undefined };
  /**
   * The person doing the looking, or null for a signed-out visitor.
   *
   * Passed even though presence is not reciprocal, because `self` needs
   * identifying: you always see your own state, or Settings could not show you
   * what everyone else sees.
   */
  viewerId: string | null;
  /** The subject's user id — compared with viewerId to detect self. */
  subjectId: string;
  /** The caller's clock. Null before hydration. */
  now: number | null;
}

/**
 * The single entry point. Every avatar, header and profile calls this.
 *
 * Order matters and is deliberate:
 *   1. YOURSELF always resolves, whatever your switches say. Settings has to be
 *      able to show you your own status, and a person hiding from others is not
 *      hiding from themselves.
 *   2. `showOnlineStatus` off hides EVERYTHING — state and last-seen alike.
 *      Leaving last-seen readable would defeat the switch entirely: "last seen
 *      1 minute ago", refreshed, is a live presence indicator with extra steps.
 *   3. `showLastSeen` off keeps the live dot and drops only the history. That
 *      is the "you can see I'm here now, you can't see my pattern" middle
 *      ground, which is the setting most people actually want.
 */
export function visiblePresence(input: VisiblePresenceInput): VisiblePresence {
  const prefs = input.subject.prefs ?? PRESENCE_PREFS_DEFAULT;
  const isSelf = input.viewerId !== null && input.viewerId === input.subjectId;

  if (!isSelf && !prefs.showOnlineStatus) return HIDDEN;

  const state = presenceOf({ lastSeenAt: input.subject.lastSeenAt, now: input.now });

  // Offline with no readable history is indistinguishable from hidden, and
  // saying "Offline" is friendlier than saying nothing — but the LABEL is what
  // carries the history, so it is gated separately below.
  const maySeeHistory = isSelf || prefs.showLastSeen;
  const label = maySeeHistory
    ? lastSeenLabel({ lastSeenAt: input.subject.lastSeenAt, now: input.now })
    : // Still name the live states — hiding "last seen" was never a request to
      // hide "is online right now", which the dot is showing anyway.
      state === "online" ? "Active now" : null;

  return { visible: true, state, label };
}

// ── The two mutual switches ────────────────────────────────────────────────

/**
 * May these two see each other's typing?
 *
 * ONE function for both directions, because the answer is symmetric by
 * construction — which is the point. A pair of one-directional checks would let
 * a future edit make them disagree, and a disagreement here means somebody's
 * typing broadcasts to a person they cannot see typing back.
 */
export function typingAllowed(a: PresencePrefs | null, b: PresencePrefs | null): boolean {
  return (a ?? PRESENCE_PREFS_DEFAULT).allowTypingIndicator
    && (b ?? PRESENCE_PREFS_DEFAULT).allowTypingIndicator;
}

/**
 * May these two see each other's read receipts?
 *
 * When false the sender's ticks stop at DELIVERED — never "Read", and never a
 * blank that would read as broken. Delivered is still true and still useful:
 * it says the message arrived, which is the half of the question that does not
 * involve the recipient's attention.
 */
export function readReceiptsAllowed(a: PresencePrefs | null, b: PresencePrefs | null): boolean {
  return (a ?? PRESENCE_PREFS_DEFAULT).allowReadReceipts
    && (b ?? PRESENCE_PREFS_DEFAULT).allowReadReceipts;
}

// ── The wire shape ─────────────────────────────────────────────────────────

/**
 * What the server is willing to TELL a given viewer about somebody's presence.
 *
 * ── Why the prefs themselves never cross the wire ─────────────────────────
 * The obvious shape is "send lastSeenAt plus their settings and let the client
 * decide". That ships the private fact to the browser and then politely asks it
 * not to look — anyone with dev tools reads the timestamp of a person who
 * switched presence off, and the switch was worthless.
 *
 * So the filtering happens on the SERVER and this carries only what the viewer
 * is already entitled to render. When presence is hidden, `lastSeenAt` is null
 * — the payload does not contain the answer at all.
 *
 * The raw timestamp is still sent when it IS allowed, because the client must
 * decay it against its own clock between polls; a server-computed "online"
 * would be stale the moment it was serialised.
 */
export interface PresenceDto {
  /** Null when hidden, unknown, or never seen. */
  lastSeenAt: string | null;
  /** They have presence switched off. The UI says so rather than guessing. */
  hidden: boolean;
  /** May worded history ("Active 2h ago") be rendered, or live state only? */
  showLastSeen: boolean;
}

/** Nothing known, nothing claimed. The safe shape for a stub or missing row. */
export const PRESENCE_DTO_EMPTY: PresenceDto = {
  lastSeenAt: null,
  hidden: false,
  showLastSeen: true,
};

/**
 * Build the wire shape for one subject and one viewer.
 *
 * The ONE function that turns stored columns into something sendable. Every
 * repo that exposes a user calls this rather than selecting `lastSeenAt`
 * straight into a DTO — which is the mistake that would quietly reintroduce the
 * leak on whichever surface forgot.
 */
export function presenceDtoFor(
  subject: {
    id: string;
    lastSeenAt: Date | string | null;
    showOnlineStatus?: boolean;
    showLastSeen?: boolean;
  },
  viewerId: string | null,
): PresenceDto {
  const isSelf = viewerId !== null && viewerId === subject.id;
  const showOnline = subject.showOnlineStatus ?? true;
  const showHistory = subject.showLastSeen ?? true;

  if (!isSelf && !showOnline) {
    return { lastSeenAt: null, hidden: true, showLastSeen: false };
  }
  const at = subject.lastSeenAt instanceof Date
    ? subject.lastSeenAt.toISOString()
    : subject.lastSeenAt;

  return { lastSeenAt: at ?? null, hidden: false, showLastSeen: isSelf || showHistory };
}

/** Human wording, so no surface invents its own. */
export const PRESENCE_COPY: Record<PresenceState | "hidden", string> = {
  online: "Online",
  away: "Away",
  offline: "Offline",
  hidden: "Presence hidden",
};
