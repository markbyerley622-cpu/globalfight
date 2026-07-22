"use client";

import { useState } from "react";
import { Loader2, UserPlus, UserCheck } from "lucide-react";
import { cn } from "@/lib/utils";

/** Follow / unfollow a person. Optimistic, with rollback on failure. */
export function FollowPersonButton({
  username,
  initialFollowing,
  signedIn,
  className,
}: {
  username: string;
  initialFollowing: boolean;
  signedIn: boolean;
  className?: string;
}) {
  const [following, setFollowing] = useState(initialFollowing);
  const [busy, setBusy] = useState(false);

  async function toggle() {
    if (!signedIn) { window.location.href = "/account"; return; }
    const next = !following;
    setFollowing(next);
    setBusy(true);
    try {
      const res = await fetch(`/api/users/${encodeURIComponent(username)}/follow`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        // Explicit, not a toggle: a retried request must not undo itself.
        body: JSON.stringify({ follow: next }),
      });
      if (!res.ok) throw new Error();
      const data = await res.json();
      if (typeof data?.following === "boolean") setFollowing(data.following);
    } catch {
      setFollowing(!next);
    } finally {
      setBusy(false);
    }
  }

  return (
    <button
      type="button"
      onClick={toggle}
      disabled={busy}
      aria-pressed={following}
      className={cn(
        "tap inline-flex items-center justify-center gap-1.5 rounded-lg px-3.5 py-2 font-display text-[0.72rem] font-bold uppercase tracking-wide transition-colors disabled:opacity-60",
        following
          ? "border border-ink-600 bg-ink-800 text-chalk hover:border-ink-500"
          : "bg-blood-500 text-white hover:bg-blood-400",
        className,
      )}
    >
      {busy ? <Loader2 className="size-3.5 animate-spin" /> : following ? <UserCheck className="size-3.5" /> : <UserPlus className="size-3.5" />}
      {following ? "Following" : "Follow"}
    </button>
  );
}
