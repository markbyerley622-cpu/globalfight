"use client";

import { usePresence } from "@/lib/presence/use-presence";
import { PRESENCE_STYLE } from "@/lib/presence/derive";
import { PRESENCE_COPY, type PresenceDto } from "@/lib/presence/policy";
import { cn } from "@/lib/utils";

// ════════════════════════════════════════════════════════════════════════════
//  The presence indicator — ONE component, everywhere an avatar appears.
//
//  ── Why there is only one ─────────────────────────────────────────────────
//  A second copy of this is a second place the privacy rules can be got wrong,
//  and the wrong one is invisible to the person it leaks about. Every surface
//  imports this and passes the DTO the server built; none of them read a
//  timestamp or a preference themselves.
//
//  ── The colours are the convention, not a choice ──────────────────────────
//  Green online, amber away, grey offline. Red is deliberately NOT in this
//  scale: across this product red already means LIVE (a card in progress, the
//  pulsing map pin) and universally means error or recording. A red presence
//  dot beside a red live badge would be two different meanings in one colour on
//  one screen.
// ════════════════════════════════════════════════════════════════════════════

/** Dot sizes. `sm` for dense lists, `md` beside a large avatar. */
const SIZE = {
  sm: "size-2.5 border-2",
  md: "size-3 border-2",
} as const;

export function PresenceDot({
  presence,
  size = "md",
  /**
   * Draw a grey dot for offline/hidden instead of nothing.
   *
   * Default TRUE, because a consistent indicator is what makes the green ones
   * legible — a dot that is sometimes absent reads as a rendering fault rather
   * than as "offline". Dense surfaces that would become a wall of grey circles
   * (a fifty-row leaderboard) pass false.
   */
  showOffline = true,
  /** Match the ring to the surface the avatar sits on. */
  ringClassName = "border-ink-900",
  className,
}: {
  presence: PresenceDto | null | undefined;
  size?: keyof typeof SIZE;
  showOffline?: boolean;
  ringClassName?: string;
  className?: string;
}) {
  const { state, hidden } = usePresence(presence);

  // Hidden and offline render IDENTICALLY and carry the same word. If "hidden"
  // looked different from "offline", the switch would announce itself — anyone
  // could tell who had something to hide, which is the opposite of a privacy
  // control.
  const quiet = hidden || state === "offline";
  if (quiet && !showOffline) return null;

  const style = quiet ? PRESENCE_STYLE.offline : PRESENCE_STYLE[state as "online" | "away"];

  return (
    <span
      className={cn(
        "absolute -bottom-0.5 -right-0.5 rounded-full",
        SIZE[size],
        ringClassName,
        // A smooth colour change, never a flash: presence transitions happen
        // while somebody is reading the row, and a blink pulls the eye to a
        // change that does not need attention.
        "transition-colors duration-500",
        className,
      )}
      style={{ background: style.color }}
    >
      {/* The colour is not information for a screen reader, and not reliable
          information for a colour-blind reader either — so the word is always
          present rather than optional. */}
      <span className="sr-only">
        {hidden ? PRESENCE_COPY.hidden : PRESENCE_COPY[state as "online" | "away" | "offline"]}
      </span>
    </span>
  );
}

/**
 * An avatar with its presence dot, positioned.
 *
 * Exists so no surface has to remember the `relative` wrapper — the bug that
 * produces is a dot anchored to the page corner, and it only shows up on the
 * one surface nobody checked.
 */
export function PresenceAvatar({
  presence, children, size = "md", showOffline = true, ringClassName, className,
}: {
  presence: PresenceDto | null | undefined;
  children: React.ReactNode;
  size?: keyof typeof SIZE;
  showOffline?: boolean;
  ringClassName?: string;
  className?: string;
}) {
  return (
    <span className={cn("relative inline-flex shrink-0", className)}>
      {children}
      <PresenceDot
        presence={presence}
        size={size}
        showOffline={showOffline}
        ringClassName={ringClassName}
      />
    </span>
  );
}

/**
 * The words — for a thread header, a profile line, a hover card.
 *
 * Renders nothing when there is nothing it is allowed to say, rather than a
 * placeholder: an empty line is quieter than "Offline" on a profile whose
 * owner has simply not been around today.
 */
export function PresenceLabel({
  presence, typing, className, showHidden = false,
}: {
  presence: PresenceDto | null | undefined;
  /** Typing OUTRANKS presence — it is strictly newer information. */
  typing?: boolean;
  className?: string;
  /** Say "Presence hidden" explicitly. For your own settings preview only. */
  showHidden?: boolean;
}) {
  const { state, label, hidden } = usePresence(presence);

  if (typing) {
    return (
      <span className={cn("text-xs font-semibold text-volt-400", className)} role="status" aria-live="polite">
        typing…
      </span>
    );
  }
  if (hidden) {
    return showHidden
      ? <span className={cn("text-xs text-fog", className)}>{PRESENCE_COPY.hidden}</span>
      : null;
  }
  if (!label) return null;

  return (
    <span className={cn("text-xs", state === "online" ? "font-semibold text-up" : "text-fog", className)}>
      {label}
    </span>
  );
}
