"use client";

import { usePresence } from "@/lib/presence/use-presence";
import { PRESENCE_STYLE } from "@/lib/presence/derive";
import { cn } from "@/lib/utils";

/**
 * The status dot, anchored to an avatar.
 *
 * ── Why offline renders NOTHING ───────────────────────────────────────────
 * A grey dot on every offline person turns the inbox into a wall of grey
 * circles and drains the signal from the green ones. Presence is only worth
 * showing when it is positive; absence of a dot is the "offline" state, and it
 * needs no ink.
 *
 * The dot is `aria-hidden` and the state is carried by a visually-hidden word
 * instead — a coloured circle is not information for a screen reader, and it is
 * not information for a colour-blind reader either, which is why the label is
 * present rather than optional.
 */
export function PresenceDot({
  lastSeenAt, className,
}: { lastSeenAt: string | null | undefined; className?: string }) {
  const { state } = usePresence(lastSeenAt);
  if (state === "offline") return null;

  const style = PRESENCE_STYLE[state];
  return (
    <span
      className={cn(
        "absolute -bottom-0.5 -right-0.5 grid size-3 place-items-center rounded-full border-2 border-ink-900",
        className,
      )}
      style={{ background: style.color }}
    >
      <span className="sr-only">{style.label}</span>
      {state === "online" && (
        // A slow breath, only on ONLINE. "Away" is a static dot: if both moved,
        // motion would stop meaning "here right now".
        <span
          aria-hidden
          className="absolute inset-0 rounded-full motion-safe:animate-ping"
          style={{ background: style.color, opacity: 0.55 }}
        />
      )}
    </span>
  );
}

/** The words, for a header or a profile line. Renders nothing when unknown. */
export function PresenceLabel({
  lastSeenAt, typing, className,
}: {
  lastSeenAt: string | null | undefined;
  /** Typing OUTRANKS presence — it is strictly newer information. */
  typing?: boolean;
  className?: string;
}) {
  const { state, label } = usePresence(lastSeenAt);

  if (typing) {
    return (
      <span className={cn("text-xs font-semibold text-volt-400", className)} role="status" aria-live="polite">
        typing…
      </span>
    );
  }
  if (!label) return null;

  return (
    <span
      className={cn("text-xs", state === "online" ? "font-semibold text-up" : "text-fog", className)}
    >
      {label}
    </span>
  );
}
