"use client";

import { useState } from "react";
import { Bell, BellRing, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { useAuth } from "@/lib/auth-client";

/**
 * Reusable follow toggle for a fighter or promotion. Optimistic, backed by
 * /api/{fighters|promotions}/{slug}/follow. Signed-out users are sent to
 * /account. One component, used on fighter profiles, event headers, and
 * anywhere else an entity can be followed — no per-surface variants.
 */
export function FollowButton({
  kind,
  slug,
  initialFollowing = false,
  size = "md",
  className,
}: {
  kind: "fighter" | "promotion";
  slug: string;
  initialFollowing?: boolean;
  size?: "sm" | "md";
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
      const res = await fetch(`/api/${kind === "fighter" ? "fighters" : "promotions"}/${encodeURIComponent(slug)}/follow`, {
        method: "POST",
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
      className={cn(
        "inline-flex items-center gap-1.5 rounded-lg border font-semibold transition-colors",
        size === "sm" ? "px-2.5 py-1 text-xs" : "px-3.5 py-2 text-sm",
        following
          ? "border-blood-500/50 bg-blood-500/15 text-blood-200"
          : "border-ink-700 text-fog hover:border-blood-500/40 hover:text-blood-300",
        className,
      )}
    >
      {busy ? (
        <Loader2 className={cn(size === "sm" ? "size-3.5" : "size-4", "animate-spin")} />
      ) : following ? (
        <BellRing className={size === "sm" ? "size-3.5" : "size-4"} />
      ) : (
        <Bell className={size === "sm" ? "size-3.5" : "size-4"} />
      )}
      {following ? "Following" : "Follow"}
    </button>
  );
}
