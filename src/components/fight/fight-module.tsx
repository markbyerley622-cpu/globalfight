"use client";

import { useEffect, useRef, useState } from "react";
import { ChevronDown, MessagesSquare, Swords } from "lucide-react";
import { ForumAvatar } from "@/components/forums/user-identity";
import { FightRoom } from "@/components/fight/fight-room";
import type { RoomSummary } from "@/lib/community/rooms";
import { cn } from "@/lib/utils";

/**
 * ONE bout, ONE module — the unit the event page is built from.
 *
 *   matchup  →  your prediction  →  your battle  →  the discussion
 *
 * The event is a container; the fight is the product. `header` and `pick` are
 * server-rendered and passed straight through, so the only client work here is
 * the arena toggle. The room mounts on open (and on a #fight-<slug> deep link
 * from a battle notification), which is why a 14-bout card runs no discussion
 * queries until a reader actually walks into one.
 */
export function FightModule({
  fightSlug, summary, header, pick,
}: {
  fightSlug: string;
  summary: RoomSummary;
  header: React.ReactNode;
  pick: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const anchor = `fight-${fightSlug}`;

  // Deep links (battle notifications, shared bouts) land INSIDE the arena.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const check = () => {
      if (window.location.hash === `#${anchor}`) {
        setOpen(true);
        setTimeout(() => ref.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 60);
      }
    };
    check();
    window.addEventListener("hashchange", check);
    return () => window.removeEventListener("hashchange", check);
  }, [anchor]);

  const battle = summary.battle;
  const battleLabel =
    battle?.state === "ACTIVE" ? `Challenge · vs ${battle.opponentName ?? "your rival"}`
    : battle?.state === "RESOLVED" ? "Challenge settled"
    : battle?.state === "WAITING" ? "Challenge sent · waiting for a rival"
    : "Challenge a rival";

  return (
    <div id={anchor} ref={ref} className="scroll-mt-16">
      {header}
      <div className="mt-3">{pick}</div>

      {/* The way in. One tap, one room, no second page. */}
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className={cn(
          "mt-3 flex w-full items-center gap-2.5 rounded-xl border px-3 py-2.5 text-left transition-colors",
          open ? "border-blood-500/40 bg-blood-500/5" : "border-ink-700 bg-ink-900/60 hover:border-ink-600",
        )}
      >
        {battle?.opponentName ? (
          <ForumAvatar name={battle.opponentName} image={battle.opponentImage} size="sm" />
        ) : (
          <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-ink-800 text-blood-300">
            <Swords className="size-4" />
          </span>
        )}
        <span className="min-w-0 flex-1">
          <span className="block truncate font-display text-sm font-bold text-chalk">{battleLabel}</span>
          <span className="flex items-center gap-1 text-[0.7rem] text-fog">
            <MessagesSquare className="size-3" />
            {summary.voices > 0 ? `${summary.voices.toLocaleString()} in the room` : "Room is quiet — go first"}
          </span>
        </span>
        <ChevronDown className={cn("size-4 shrink-0 text-fog transition-transform", open && "rotate-180")} />
      </button>

      {open && <FightRoom fightSlug={fightSlug} />}
    </div>
  );
}
