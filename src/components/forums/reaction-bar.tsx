"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";
import Image from "next/image";
import { REACTION_TYPES, REACTION_META, type ReactionType } from "@/lib/forum/types";

// Owner-supplied reaction art: Respect (fist) / Disrespect (middle finger).
const REACTION_IMG: Record<ReactionType, string> = {
  respect: "/brand/reactions/respect.png",
  disrespect: "/brand/reactions/middle-finger.png",
};

/**
 * Combat Register reactions: Respect (fist) / Disrespect (middle finger).
 * Optimistic toggle, then reconciles with the server's authoritative counts.
 * Realtime `post:react` ticks reload the thread, so counts converge across devices.
 */
export function ReactionBar({
  postId, initialCounts, initialMine, requireAuth,
}: {
  postId: string;
  initialCounts: Record<string, number>;
  initialMine: string[];
  requireAuth: boolean;
}) {
  const [counts, setCounts] = useState<Record<string, number>>(initialCounts);
  const [mine, setMine] = useState<Set<string>>(new Set(initialMine));
  const [busy, setBusy] = useState<string | null>(null);

  // Respect and Disrespect are MUTUALLY EXCLUSIVE — picking one clears the other.
  async function toggle(type: ReactionType) {
    if (requireAuth) { window.location.href = "/account"; return; }
    if (busy) return;
    const opposite: ReactionType = type === "respect" ? "disrespect" : "respect";
    const hadType = mine.has(type);
    const hadOpposite = mine.has(opposite);

    // Snapshot for rollback.
    const prevMine = new Set(mine);
    const prevCounts = { ...counts };

    // Optimistic: toggle `type`; if turning it ON, drop the opposite.
    setMine((prev) => {
      const n = new Set(prev);
      if (hadType) n.delete(type);
      else { n.add(type); n.delete(opposite); }
      return n;
    });
    setCounts((prev) => {
      const next = { ...prev };
      if (hadType) next[type] = Math.max(0, (next[type] ?? 0) - 1);
      else {
        next[type] = (next[type] ?? 0) + 1;
        if (hadOpposite) next[opposite] = Math.max(0, (next[opposite] ?? 0) - 1);
      }
      return next;
    });
    setBusy(type);
    try {
      const post = (t: string) => fetch(`/api/forums/posts/${postId}/react`, {
        method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ type: t }),
      });
      let res = await post(type);
      let d = res.ok ? await res.json() : null;
      // If we just turned `type` ON and the opposite was set, remove the opposite too.
      if (res.ok && !hadType && hadOpposite) {
        res = await post(opposite);
        if (res.ok) d = await res.json();
      }
      if (d) { setCounts(d.reactions ?? {}); setMine(new Set<string>(d.myReactions ?? [])); }
      else { setMine(prevMine); setCounts(prevCounts); }
    } catch {
      setMine(prevMine); setCounts(prevCounts);
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {REACTION_TYPES.map((type) => {
        const active = mine.has(type);
        const count = counts[type] ?? 0;
        return (
          <button
            key={type}
            onClick={() => toggle(type as ReactionType)}
            title={REACTION_META[type].label}
            aria-pressed={active}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-semibold transition-colors active:scale-95",
              active
                ? type === "respect"
                  ? "border-emerald-500/50 bg-emerald-500/15 text-emerald-300"
                  : "border-blood-500/50 bg-blood-500/15 text-blood-200"
                : "border-ink-700 bg-ink-950/30 text-fog hover:border-ink-600 hover:text-mist",
            )}
          >
            <Image src={REACTION_IMG[type]} alt="" width={20} height={20} className="size-5 object-contain" />
            <span className="hidden sm:inline">{REACTION_META[type].label}</span>
            {count > 0 && <span className="tabular-nums">{count}</span>}
          </button>
        );
      })}
    </div>
  );
}
