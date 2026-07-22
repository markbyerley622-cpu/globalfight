"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Bell, BellRing, UserCheck, UserPlus } from "lucide-react";
import { cn } from "@/lib/utils";
import { useAuth } from "@/lib/auth-client";
import { broadcastFollowChange } from "@/components/layout/follow-sync";

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
 * Reusable follow toggle for a fighter, promotion, event or person. Optimistic,
 * backed by /api/{fighters|promotions|events|users}/{slug}/follow. Signed-out
 * users are sent to /account. One component, used on fighter profiles, event
 * headers, event cards, map pins and feed cards — no per-surface variants.
 *
 * ── HOW THE REST OF THE APP STAYS IN SYNC ────────────────────────────────
 * There is no client cache in this codebase — no React Query, no SWR, no
 * store — and this deliberately does not introduce one. Postgres is the single
 * source of truth and every surface that shows follow state (the Following
 * header counts, the feed itself, the recommendation rails, the related-video
 * rail, the empty state) is a SERVER component derived from it.
 *
 * So the invalidation primitive is router.refresh(), which this codebase
 * already uses for exactly this job in the avatar uploader, the forum thread
 * and the locale switcher: it re-runs the server components in place, without
 * a page reload, preserving scroll and client state. One mutation, one
 * refresh, every dependent surface re-derived — and nothing to go stale,
 * because there is no second copy of the truth.
 *
 * The refresh fires only AFTER the server confirms. Refreshing optimistically
 * would re-render from a database that had not been written yet and visually
 * undo the flip the user just made.
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
  const router = useRouter();
  const [following, setFollowing] = useState(initialFollowing);
  const [busy, setBusy] = useState(false);

  // useState ignores later prop values, so after a router.refresh() the button
  // would keep its own copy forever. Re-sync when the server sends a different
  // answer — this is what stops the one piece of client state from drifting
  // away from the source of truth it was seeded from.
  useEffect(() => { setFollowing(initialFollowing); }, [initialFollowing]);

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
      if (res.ok) {
        setFollowing(!!(await res.json()).following);
        // Re-derive every server-rendered surface: header counts, the feed,
        // the rails, the empty state. Not awaited — the button is already
        // correct and the user must not wait on a re-render.
        router.refresh();
        // Tell OTHER TABS to re-derive. The listener lives in AppShell, not
        // here: a tab showing a feed with no fighter cards has no FollowButton
        // mounted, so a listener in this component would simply not exist in
        // the tab that most needs telling.
        broadcastFollowChange();
      } else {
        setFollowing(!optimistic);
      }
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
