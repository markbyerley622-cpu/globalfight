"use client";

import { useState } from "react";
import { Bell, BellRing, UserCheck, UserPlus } from "lucide-react";
import { cn } from "@/lib/utils";
import { useAuth } from "@/lib/auth-client";

// Entity kind → its follow endpoint. Adding a followable thing is one line here,
// never a new component.
const ENDPOINT = {
  fighter: "fighters",
  promotion: "promotions",
  event: "events",
  person: "users",
} as const;

// Person follows use a different icon pair — following a human is not a bell.
const ICONS = {
  on: { fighter: BellRing, promotion: BellRing, event: BellRing, person: UserCheck },
  off: { fighter: Bell, promotion: Bell, event: Bell, person: UserPlus },
} as const;

export type FollowKind = keyof typeof ENDPOINT;

/**
 * Reusable follow toggle for a fighter, promotion or event. Optimistic, backed
 * by /api/{fighters|promotions|events}/{slug}/follow. Signed-out users are sent
 * to /account. One component, used on fighter profiles, event headers, event
 * cards and anywhere else an entity can be followed — no per-surface variants.
 */
export function FollowButton({
  kind,
  slug,
  initialFollowing = false,
  size = "md",
  label,
  name,
  className,
}: {
  kind: FollowKind;
  slug: string;
  initialFollowing?: boolean;
  size?: "sm" | "md";
  /** Override the resting label (e.g. "Remind me" on an event). */
  label?: string;
  /** What is being followed, for the screen-reader label. Without it a reader
   *  hears "Following" with no idea what — on a feed of ten fighter cards that
   *  is ten identical buttons. */
  name?: string;
  className?: string;
}) {
  const { user } = useAuth();
  const [following, setFollowing] = useState(initialFollowing);
  const [busy, setBusy] = useState(false);

  async function toggle() {
    if (!user) { window.location.href = "/account"; return; }
    if (busy) return;
    setBusy(true);
    const optimistic = !following;
    setFollowing(optimistic);
    try {
      const res = await fetch(`/api/${ENDPOINT[kind]}/${encodeURIComponent(slug)}/follow`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        // EXPLICIT intent, never a bare toggle: a retry, a double tap or a
        // second tab must all mean the same thing rather than undoing it.
        body: JSON.stringify({ follow: optimistic }),
      });
      if (res.ok) setFollowing(!!(await res.json()).following);
      else setFollowing(!optimistic);
    } catch {
      setFollowing(!optimistic);
    } finally {
      setBusy(false);
    }
  }

  return (
    <button
      type="button"
      onClick={toggle}
      aria-pressed={following}
      aria-busy={busy}
      aria-label={name ? `${following ? "Following" : "Not following"} ${name}` : undefined}
      className={cn(
        // min-h-11 = 44px: the touch target has to be reachable with a thumb,
        // and the small variant was 26px tall.
        "inline-flex min-h-11 items-center gap-1.5 rounded-lg border font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blood-400",
        // The in-flight state is opacity only. Swapping the icon for a spinner
        // moved the label and made a 150ms request feel like a page load —
        // and the update is optimistic, so there is nothing to wait for.
        busy && "opacity-60",
        size === "sm" ? "px-2.5 py-1 text-xs" : "px-3.5 py-2 text-sm",
        following
          ? "border-blood-500/50 bg-blood-500/15 text-blood-200"
          : "border-ink-700 text-fog hover:border-blood-500/40 hover:text-blood-300",
        className,
      )}
    >
      {(() => {
        const I = following ? ICONS.on[kind] : ICONS.off[kind];
        return <I className={size === "sm" ? "size-3.5" : "size-4"} />;
      })()}
      {following ? "Following" : label ?? "Follow"}
    </button>
  );
}
