"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Ban, ShieldOff } from "lucide-react";
import { cn } from "@/lib/utils";
import { useAuthGate } from "@/lib/auth-client";

/**
 * Block / unblock a person.
 *
 * ── Why it CONFIRMS and the follow button does not ───────────────────────
 * Blocking severs both follows, empties the conversation out of both inboxes
 * and hides the other person's posts. None of that is restored by unblocking,
 * so a mis-tap is not free the way a mis-tapped follow is. One confirm step,
 * inline rather than a modal, so it costs a tap and not a context switch.
 *
 * ── Why there is no optimistic update ────────────────────────────────────
 * The follow button flips instantly because a follow is cheap and reversible.
 * Here the button's own claim ("blocked") is a safety statement, and showing it
 * before the server has written the row would tell someone they were protected
 * when they might not be. It waits.
 */
export function BlockButton({
  username,
  name,
  initialBlocked = false,
  className,
}: {
  username: string;
  /** Named in the confirm copy — "Block Dana?" beats "Block this user?". */
  name: string;
  initialBlocked?: boolean;
  className?: string;
}) {
  const gate = useAuthGate();
  const router = useRouter();
  const [blocked, setBlocked] = useState(initialBlocked);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);

  async function apply(next: boolean) {
    if (gate.requireSignIn() !== "OK") return;
    if (busy) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/users/${encodeURIComponent(username)}/block`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        // Explicit intent, never a bare toggle: a retry must not un-block
        // someone who is meant to stay blocked.
        body: JSON.stringify({ blocked: next }),
      });
      if (res.ok) {
        setBlocked(!!(await res.json()).blocked);
        setConfirming(false);
        // Blocking changes what the SERVER renders — the thread list, the
        // follow state, the posts on this very page. Re-derive rather than
        // patch a client copy; the codebase has no client cache by design.
        router.refresh();
      }
    } catch {
      /* leave the button where it was; the state it shows is still true */
    } finally {
      setBusy(false);
    }
  }

  const base =
    "inline-flex min-h-11 items-center gap-1.5 rounded-lg border px-3 py-2 text-sm font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blood-400";

  if (blocked) {
    return (
      <button
        type="button"
        onClick={() => apply(false)}
        aria-busy={busy}
        aria-label={`Unblock ${name}`}
        className={cn(base, "border-blood-500/50 bg-blood-500/15 text-blood-200", busy && "opacity-60", className)}
      >
        <ShieldOff className="size-4" />
        Blocked
      </button>
    );
  }

  if (confirming) {
    return (
      <span className="inline-flex items-center gap-1.5">
        <button
          type="button"
          onClick={() => apply(true)}
          aria-busy={busy}
          className={cn(base, "border-blood-500 bg-blood-500 text-white", busy && "opacity-60")}
        >
          <Ban className="size-4" />
          Block {name}
        </button>
        <button
          type="button"
          onClick={() => setConfirming(false)}
          className={cn(base, "border-ink-700 text-fog hover:text-chalk")}
        >
          Cancel
        </button>
      </span>
    );
  }

  return (
    <button
      type="button"
      onClick={() => setConfirming(true)}
      aria-label={`Block ${name}`}
      className={cn(base, "border-ink-700 text-fog hover:border-blood-500/40 hover:text-blood-300", className)}
    >
      <Ban className="size-4" />
      Block
    </button>
  );
}
