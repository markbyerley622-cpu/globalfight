import "server-only";

// ════════════════════════════════════════════════════════════════════════════
//  The presence SELECT fragment.
//
//  ── Why this is a shared constant ─────────────────────────────────────────
//  Presence is meant to appear anywhere an avatar does, and each of those
//  surfaces has its own Prisma query. Spelling the columns out per query means
//  that the day a fifth switch is added, presence silently loses it on every
//  query that was not updated — and the failure mode is a privacy setting that
//  does nothing, which nobody notices because the person it concerns cannot
//  see the surfaces it leaks on.
//
//  Spread this into a `select` and the row is guaranteed to satisfy
//  `presenceDtoFor`. Adding a switch is one line here.
// ════════════════════════════════════════════════════════════════════════════

/**
 * Everything `presenceDtoFor` needs, and nothing else.
 *
 * `id` is included on purpose — the DTO builder needs it to recognise the
 * viewer looking at their own row, and a caller that had to remember to add it
 * separately would eventually forget and break "you always see yourself".
 */
export const PRESENCE_SELECT = {
  id: true,
  lastSeenAt: true,
  showOnlineStatus: true,
  showLastSeen: true,
} as const;

/**
 * The row shape `PRESENCE_SELECT` produces.
 *
 * Exported so a repo that hand-writes a row TYPE can intersect this instead of
 * restating the column names. Restating them compiles fine and is exactly what
 * the no-raw-presence guard flags — correctly, because a hand-written list is
 * the thing that goes stale when a fifth switch is added.
 */
export type PresenceRow = {
  id: string;
  lastSeenAt: Date | null;
  showOnlineStatus: boolean;
  showLastSeen: boolean;
};

/** The two MUTUAL switches, for surfaces that gate typing or read receipts. */
export const PRESENCE_MUTUAL_SELECT = {
  allowTypingIndicator: true,
  allowReadReceipts: true,
} as const;
