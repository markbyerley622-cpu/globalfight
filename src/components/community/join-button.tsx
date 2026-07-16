"use client";

import { useState } from "react";
import Link from "next/link";
import { Check, Plus, Loader2 } from "lucide-react";
import { useAuth } from "@/lib/auth-client";
import { cn } from "@/lib/utils";

export function JoinButton({
  slug, initialIsMember, initialMemberCount, size = "md", showCount = false,
}: {
  slug: string;
  initialIsMember: boolean;
  initialMemberCount: number;
  size?: "sm" | "md";
  showCount?: boolean;
}) {
  const { user } = useAuth();
  const [isMember, setIsMember] = useState(initialIsMember);
  const [count, setCount] = useState(initialMemberCount);
  const [busy, setBusy] = useState(false);

  const pad = size === "sm" ? "px-3 py-1.5 text-xs" : "px-4 py-2 text-sm";

  if (!user) {
    return (
      <Link
        href="/account"
        className={cn("inline-flex items-center gap-1.5 rounded-lg bg-blood-500 font-display font-semibold uppercase tracking-wide text-white transition-colors hover:bg-blood-400", pad)}
      >
        <Plus className="size-4" /> Join
      </Link>
    );
  }

  async function toggle() {
    if (busy) return;
    setBusy(true);
    const next = !isMember;
    // optimistic
    setIsMember(next);
    setCount((c) => Math.max(0, c + (next ? 1 : -1)));
    try {
      const res = await fetch(`/api/communities/${slug}/membership`, { method: next ? "POST" : "DELETE" });
      if (!res.ok) throw new Error();
      const data = (await res.json()) as { isMember: boolean; memberCount: number };
      setIsMember(data.isMember);
      setCount(data.memberCount);
    } catch {
      // revert on failure
      setIsMember(!next);
      setCount((c) => Math.max(0, c + (next ? -1 : 1)));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex items-center gap-2">
      <button
        onClick={toggle}
        disabled={busy}
        className={cn(
          "inline-flex items-center gap-1.5 rounded-lg font-display font-semibold uppercase tracking-wide transition-colors disabled:opacity-60",
          pad,
          isMember
            ? "border border-ink-700 bg-ink-850 text-mist hover:border-blood-500/40 hover:text-blood-300"
            : "bg-blood-500 text-white hover:bg-blood-400",
        )}
      >
        {busy ? <Loader2 className="size-4 animate-spin" /> : isMember ? <Check className="size-4" /> : <Plus className="size-4" />}
        {isMember ? "Joined" : "Join"}
      </button>
      {showCount && (
        <span className="text-xs tabular-nums text-fog">{count.toLocaleString()} member{count === 1 ? "" : "s"}</span>
      )}
    </div>
  );
}
