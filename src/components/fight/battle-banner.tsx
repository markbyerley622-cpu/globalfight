"use client";

import Link from "next/link";
import { Mic, Swords, Trophy, X } from "lucide-react";
import { ForumAvatar } from "@/components/forums/user-identity";
import { PickLine, RecordLine } from "@/components/forums/pick-identity";
import { Countdown } from "@/components/countdown";
import type { BattleRoomDTO, RoomIdentity } from "@/lib/community/room-types";
import { cn } from "@/lib/utils";

/**
 * The persistent battle banner. It is ALWAYS visible while you're inside a
 * battle room — you never scroll to rediscover who you're arguing with, what
 * either of you called, or how long until the fight settles it.
 */
export function BattleBanner({ battle, fightDate }: { battle: BattleRoomDTO; fightDate: string }) {
  const settled = battle.state === "RESOLVED";
  const iWon = settled && battle.winnerId === battle.you.userId;
  const iLost = settled && !!battle.winnerId && battle.winnerId !== battle.you.userId;

  return (
    <div
      className={cn(
        "sticky top-0 z-10 rounded-xl border bg-ink-950/95 p-3 backdrop-blur",
        iWon ? "border-up/40" : iLost ? "border-blood-500/40" : "border-ink-700",
      )}
    >
      <div className="mb-2.5 flex items-center justify-between gap-2">
        <span className="inline-flex items-center gap-1.5 text-[0.65rem] font-bold uppercase tracking-wider text-blood-300">
          <Swords className="size-3.5" />
          {settled ? "Battle settled" : battle.state === "WAITING" ? "Battle open" : "Your battle"}
        </span>
        <span className="inline-flex items-center gap-2">
          {battle.meetings > 0 && (
            <span className="text-[0.65rem] uppercase tracking-wider text-fog">
              {battle.meetings === 1 ? "First meeting" : `Met ${battle.meetings}×`}
            </span>
          )}
          {battle.streak.count > 0 && (
            <span className={cn("rounded px-1.5 py-0.5 text-[0.65rem] font-bold", battle.streak.mine ? "bg-up/15 text-up" : "bg-blood-500/15 text-blood-300")}>
              {battle.streak.mine ? "You lead" : "They lead"} {battle.streak.count}
            </span>
          )}
        </span>
      </div>

      <div className="grid grid-cols-[1fr_auto_1fr] items-start gap-2">
        <Side identity={battle.you} label="You" align="left" outcome={settled ? (iWon ? "win" : iLost ? "loss" : "draw") : null} />
        <span className="pt-2 font-display text-xs font-black text-fog">VS</span>
        {battle.opponent ? (
          <Side
            identity={battle.opponent}
            label={battle.opponent.name}
            align="right"
            showRecord
            outcome={settled ? (iWon ? "loss" : iLost ? "win" : "draw") : null}
          />
        ) : (
          <p className="animate-pulse pt-1 text-right text-[0.7rem] text-fog">
            Waiting for someone to take the other side…
          </p>
        )}
      </div>

      <div className="mt-3 flex items-center justify-between gap-2 border-t border-ink-800 pt-2.5">
        <span className="inline-flex items-center gap-1 text-[0.65rem] uppercase tracking-wider text-fog">
          {settled ? (
            <span className={cn("inline-flex items-center gap-1 font-bold", iWon ? "text-up" : iLost ? "text-blood-300" : "text-mist")}>
              {iWon ? <><Trophy className="size-3.5" /> You won it</> : iLost ? <><X className="size-3.5" /> They called it</> : "Drawn"}
            </span>
          ) : (
            <>Settles in <Countdown date={fightDate} compact /></>
          )}
        </span>
        <button
          type="button"
          disabled
          title="Voice Debate — coming soon"
          className="inline-flex cursor-not-allowed items-center gap-1 rounded-lg border border-ink-700 px-2.5 py-1 text-[0.7rem] font-semibold text-fog/60"
        >
          <Mic className="size-3.5" /> Voice · soon
        </button>
      </div>
    </div>
  );
}

function Side({
  identity, label, align, showRecord, outcome,
}: {
  identity: RoomIdentity; label: string; align: "left" | "right";
  showRecord?: boolean; outcome: "win" | "loss" | "draw" | null;
}) {
  const avatar = <ForumAvatar name={identity.name} image={identity.image} size="sm" />;
  return (
    <div className={cn("flex min-w-0 items-start gap-2", align === "right" && "flex-row-reverse text-right")}>
      {identity.username ? (
        <Link href={`/u/${identity.username}`} className="shrink-0 hover:opacity-80">{avatar}</Link>
      ) : avatar}
      <div className="min-w-0">
        <p className="truncate font-display text-sm font-bold text-chalk">
          {label}
          {outcome === "win" && <span className="ml-1 text-up">✓</span>}
        </p>
        <PickLine identity={identity} className="text-[0.7rem]" />
        {showRecord && <RecordLine identity={identity} className="mt-1 flex" />}
      </div>
    </div>
  );
}
