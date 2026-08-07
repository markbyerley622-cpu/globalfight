// ════════════════════════════════════════════════════════════════════════════
//  PRESENCE — one derivation, every surface.
//
//  ── Why this module exists ────────────────────────────────────────────────
//  "Is this person around?" is asked by the inbox row, the thread header, the
//  profile page and (soon) any live event room. Answered independently, those
//  drift within a release: one calls 90 seconds "online", another calls it
//  "away", and the same person reads as two different things on two screens.
//
//  ── Why a TIMESTAMP and never a boolean ───────────────────────────────────
//  An `isOnline` column has to be set to false by something, and that something
//  is a disconnect the server never observes: a closed laptop, a killed tab, a
//  train tunnel. Every product that stores online as a flag eventually shows
//  somebody online for three days.
//
//  A heartbeat timestamp cannot get stuck. Presence is `now - lastSeenAt`, so
//  it decays on its own with nothing to clean up, no sweep to schedule and no
//  correctness dependency on a graceful disconnect. This is the same rule
//  `ConversationMember.typingAt` already follows — presence is that idea
//  generalised past typing.
//
//  PURE. No prisma, no React, no `Date.now()` — the caller passes `now`, which
//  is what lets one clock reading drive a whole inbox and what makes it
//  testable at the boundaries.
// ════════════════════════════════════════════════════════════════════════════

/** Coarse presence. Three states, because a fourth is not legible at a glance. */
export type PresenceState =
  /** Heartbeat within ONLINE_MS — the app is open in front of them. */
  | "online"
  /** Heartbeat within AWAY_MS — recently there, tab probably backgrounded. */
  | "away"
  /** Older than that, or never seen. */
  | "offline";

/**
 * A heartbeat lands at most every HEARTBEAT_MS, so the online window must be
 * comfortably wider than that or a perfectly present user flickers offline
 * between beats. 3× is the usual ratio (typing uses ~2×, but typing is allowed
 * to be twitchy and presence is not).
 */
export const HEARTBEAT_MS = 45_000;
export const ONLINE_MS = 135_000;
export const AWAY_MS = 8 * 60_000;

export interface PresenceInput {
  /** ISO or Date of the last heartbeat. Null = never seen. */
  lastSeenAt: string | Date | null | undefined;
  /** Caller's clock. Null before hydration — see the return note. */
  now: number | null;
}

/**
 * Derive presence.
 *
 * Returns "offline" when `now` is null — the server and the hydration pass.
 * That is the calm answer on purpose: a dot that renders green for one frame
 * and corrects itself to grey is worse than one that arrives grey and turns
 * green, because the first reads as a glitch and the second as an update.
 */
export function presenceOf(input: PresenceInput): PresenceState {
  if (!input.lastSeenAt || input.now === null) return "offline";
  const at = input.lastSeenAt instanceof Date
    ? input.lastSeenAt.getTime()
    : new Date(input.lastSeenAt).getTime();
  if (!Number.isFinite(at)) return "offline";

  // A clock skewed into the future must not read as offline. Clamp at 0.
  const age = Math.max(0, input.now - at);
  if (age < ONLINE_MS) return "online";
  if (age < AWAY_MS) return "away";
  return "offline";
}

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/**
 * "Active now" / "Active 12m ago" / "Active yesterday".
 *
 * ── Deliberately COARSE the further back it goes ──────────────────────────
 * A precise "last seen 14:32 on 3 August" is a surveillance readout, not a
 * social signal: it tells a stranger when somebody sleeps and when they are at
 * work. The resolution drops as the age rises — minutes within the hour, hours
 * within the day, then just the day — which is the granularity people actually
 * use ("earlier today") and carries far less about somebody's routine.
 *
 * Beyond a week it stops reporting at all rather than saying "active 4 months
 * ago", which is only ever a statement about how little someone is missed.
 */
export function lastSeenLabel(input: PresenceInput): string | null {
  const state = presenceOf(input);
  if (state === "online") return "Active now";
  if (!input.lastSeenAt || input.now === null) return null;

  const at = input.lastSeenAt instanceof Date
    ? input.lastSeenAt.getTime()
    : new Date(input.lastSeenAt).getTime();
  if (!Number.isFinite(at)) return null;

  const age = Math.max(0, input.now - at);
  if (age < HOUR) return `Active ${Math.max(1, Math.floor(age / MINUTE))}m ago`;
  if (age < DAY) return `Active ${Math.floor(age / HOUR)}h ago`;
  if (age < 2 * DAY) return "Active yesterday";
  if (age < 7 * DAY) return `Active ${Math.floor(age / DAY)}d ago`;
  return null;
}

/** Presentation, in one table so no surface invents its own green. */
export const PRESENCE_STYLE: Record<PresenceState, { color: string; label: string }> = {
  online: { color: "#22c55e", label: "Online" },
  away: { color: "#f5c542", label: "Away" },
  offline: { color: "#788495", label: "Offline" },
};

// ── Delivery ───────────────────────────────────────────────────────────────

/**
 * What has happened to a message I sent.
 *
 * ── Each state is EARNED, never assumed ───────────────────────────────────
 * The temptation is to show ✓✓ the moment the server responds, because it
 * looks better. That is a lie the user finds out about when they ask "did you
 * get my message?" and the answer is no. Each step below corresponds to a fact
 * somebody's client actually caused:
 *
 *   sending   — optimistic. No server acknowledgement yet; may still fail.
 *   sent      — the row exists. The server has it; the recipient may not.
 *   delivered — the RECIPIENT'S client has fetched this conversation since the
 *               message was written (ConversationMember.lastDeliveredAt, moved
 *               by their inbox poll or their thread poll). Their device has the
 *               bytes.
 *   read      — the recipient has had the THREAD open since it was written
 *               (lastReadAt). They have looked at it.
 *
 * The gap between delivered and read is real and is the whole point: their
 * phone has it, their eyes have not.
 */
export type DeliveryState = "sending" | "sent" | "delivered" | "read";

export interface DeliveryInput {
  /** The message's own timestamp. */
  at: string;
  /** True while the message is still an unacknowledged optimistic row. */
  optimistic: boolean;
  /** The other member's `lastDeliveredAt`, ISO or null. */
  otherDeliveredAt: string | null;
  /** The other member's `lastReadAt`, ISO or null. */
  otherReadAt: string | null;
}

const atOrZero = (iso: string | null): number => {
  if (!iso) return 0;
  const t = new Date(iso).getTime();
  return Number.isFinite(t) ? t : 0;
};

export function deliveryOf(input: DeliveryInput): DeliveryState {
  if (input.optimistic) return "sending";
  const sent = atOrZero(input.at);
  // Read implies delivered, so it is checked first — a watermark comparison
  // that ran the other way could report "delivered" for a message the recipient
  // has demonstrably read.
  if (atOrZero(input.otherReadAt) >= sent) return "read";
  if (atOrZero(input.otherDeliveredAt) >= sent) return "delivered";
  return "sent";
}
