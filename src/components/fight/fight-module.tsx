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
    // Describes the STATE OF YOUR BATTLE, in the same vocabulary the room's own
    // tabs use ("Rival" / "Everyone" — see fight-room). This row used to read
    // "Challenge a friend", which is a call to action, on a control whose only
    // function is to expand a discussion. Two different promises from one row.
    //
    // "friend" is still the word in the INVITE copy inside the picker itself:
    // asking someone to challenge a rival reads as picking a fight with a
    // stranger. Here, where it is reporting rather than inviting, it is neutral.
    battle?.state === "ACTIVE" ? `Rival · ${battle.opponentName ?? "your opponent"}`
    : battle?.state === "RESOLVED" ? "Rivalry settled"
    : battle?.state === "WAITING" ? "Invite sent · waiting"
    : "No rival yet";

  return (
    <div id={anchor} ref={ref} className="scroll-mt-16">
      {header}
      <div className="mt-3">{pick}</div>

      {/* The way in. One tap, one room, no second page.
          The COUNT LEADS. It used to be a 10px line of grey text under the
          battle label — "23 in the room" — which is the single strongest signal
          on a fight card that there is something happening here, rendered as
          the quietest thing on it. A reader scanning fourteen bouts for the one
          worth opening was being asked to read fourteen subtitles.
          It is now a counter chip on the left of the row, sized and weighted
          like the notification badges elsewhere in the app, and it lights up
          in blood when the room is actually busy. */}
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-label={
          summary.voices > 0
            ? `Discussion — ${summary.voices} message${summary.voices === 1 ? "" : "s"}. ${battleLabel}`
            : `Discussion — no messages yet. ${battleLabel}`
        }
        className={cn(
          "mt-3 flex w-full items-center gap-2.5 rounded-lg border px-3 py-2.5 text-left transition-all",
          open
            ? "border-blood-500/40 bg-blood-500/5"
            : "border-ink-700 bg-ink-900/60 hover:border-ink-600 hover:bg-ink-900 active:scale-[0.995]",
        )}
      >
        <span
          className={cn(
            "flex min-h-8 shrink-0 items-center gap-1.5 rounded-full border px-2.5 font-display text-xs font-black tabular-nums transition-colors",
            summary.voices > 0
              ? "border-blood-500/45 bg-blood-500/15 text-blood-200"
              : "border-ink-700 bg-ink-800 text-fog",
          )}
        >
          <MessagesSquare className="size-3.5" aria-hidden />
          {summary.voices > 0 ? summary.voices.toLocaleString() : "0"}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate font-display text-sm font-bold text-chalk">
            {summary.voices > 0 ? "Discussion" : "Start the discussion"}
          </span>
          <span className="flex items-center gap-1.5 truncate text-2xs text-fog">
            {battle?.opponentName && (
              <ForumAvatar name={battle.opponentName} image={battle.opponentImage} size="sm" className="size-4" />
            )}
            {!battle?.opponentName && <Swords className="size-3 shrink-0" aria-hidden />}
            <span className="truncate">{battleLabel}</span>
          </span>
        </span>
        <ChevronDown className={cn("size-4 shrink-0 text-fog transition-transform", open && "rotate-180")} />
      </button>

      {open && <FightRoom fightSlug={fightSlug} />}
    </div>
  );
}
