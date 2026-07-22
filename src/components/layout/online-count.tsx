"use client";

import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";

/**
 * "N online" in the top bar.
 *
 * Polls a cached aggregate rather than holding a socket: the number is derived
 * from pageview events that are written anyway, and a websocket for a status
 * badge is infrastructure nobody asked for.
 *
 * Renders NOTHING until it has a real number — a badge that says "0 online"
 * while loading reads as "this place is dead", which is the one impression it
 * exists to prevent.
 */
export function OnlineCount({ className }: { className?: string }) {
  const [n, setN] = useState<number | null>(null);

  useEffect(() => {
    let live = true;
    const load = () =>
      fetch("/api/online")
        .then((r) => (r.ok ? r.json() : null))
        .then((d) => { if (live && typeof d?.total === "number") setN(d.total); })
        .catch(() => {});
    load();
    // Slower than the server cache so every poll can actually move the number.
    const id = setInterval(load, 60_000);
    // Refresh on return to the tab — a stale count after lunch is worse than none.
    const onVis = () => { if (document.visibilityState === "visible") load(); };
    document.addEventListener("visibilitychange", onVis);
    return () => { live = false; clearInterval(id); document.removeEventListener("visibilitychange", onVis); };
  }, []);

  if (n === null) return null;

  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center gap-1.5 rounded-full border border-ink-700 bg-ink-900/70 px-2.5 py-1.5 backdrop-blur",
        className,
      )}
      title={`${n} ${n === 1 ? "person" : "people"} active in the last few minutes`}
    >
      <span aria-hidden className={cn("size-1.5 rounded-full", n > 0 ? "bg-up shadow-[0_0_6px] shadow-up" : "bg-fog")} />
      <span className="font-display text-[0.68rem] font-bold tabular-nums text-chalk">{n}</span>
      <span className="font-display text-[0.62rem] font-bold uppercase tracking-wider text-fog">online</span>
    </span>
  );
}
