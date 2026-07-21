"use client";

import Link from "next/link";
import { Swords, Mic } from "lucide-react";
import { ForumAvatar } from "@/components/forums/user-identity";
import { Countdown } from "@/components/countdown";
import type { FightBattle } from "@/lib/battles";

// Prediction Battles — the "Your Battle" card on the fight. Makes "you vs them
// until the fight settles it" impossible to miss, right where the pick is made.
// Reuses existing tokens/avatar/countdown; mobile-first (stacks, no h-scroll).
const METHOD: Record<string, string> = {
  KO: "KO", TKO: "TKO", SUB: "Sub", UD: "Decision", SD: "Decision", MD: "Decision", DQ: "DQ", RTD: "Sub", TD: "Decision",
};
const label = (m: string | null): string | null => (m ? METHOD[m] ?? m : null);
const stars = (c: number | null): string | null => (c ? "★".repeat(c) : null);

function Side({ name, fighter, method, conf, image, href, align }: {
  name: string; fighter: string; method: string | null; conf: string | null;
  image?: string | null; href?: string; align: "left" | "right";
}) {
  const meta = [fighter, method, conf].filter(Boolean).join(" · ");
  const nameEl = href ? (
    <Link href={href} className="truncate font-display text-sm font-bold text-chalk hover:text-blood-300 hover:underline">{name}</Link>
  ) : (
    <span className="truncate font-display text-sm font-bold text-chalk">{name}</span>
  );
  return (
    <div className={`flex min-w-0 items-center gap-2 ${align === "right" ? "flex-row-reverse text-right" : ""}`}>
      {image !== undefined && (href ? <Link href={href} className="shrink-0 hover:opacity-80"><ForumAvatar name={name} image={image} size="sm" /></Link> : <ForumAvatar name={name} image={image} size="sm" />)}
      <div className="min-w-0">
        {nameEl}
        <p className="truncate text-[0.7rem] text-fog">{meta}</p>
      </div>
    </div>
  );
}

export function BattleCard({
  myFighter, myMethod, myConfidence, theirFighter, battle, fightDate, discussionHref,
}: {
  myFighter: string;
  myMethod: string | null;
  myConfidence: number | null;
  theirFighter: string;
  battle: FightBattle;
  fightDate: string;
  discussionHref: string;
}) {
  const opp = battle.opponent;
  return (
    <div className="card-surface mt-3 p-3">
      <div className="mb-2.5 flex items-center justify-between">
        <span className="inline-flex items-center gap-1.5 text-[0.65rem] font-bold uppercase tracking-wider text-blood-300">
          <Swords className="size-3.5" /> Your battle
        </span>
        {battle.record && (battle.record.you || battle.record.them) ? (
          <span className="rounded bg-ink-800 px-1.5 py-0.5 text-[0.65rem] font-bold tabular-nums text-chalk">
            {battle.record.you}–{battle.record.them}
          </span>
        ) : null}
      </div>

      <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2">
        <Side name="You" fighter={myFighter} method={label(myMethod)} conf={stars(myConfidence)} align="left" />
        <span className="font-display text-xs font-black text-fog">VS</span>
        {opp ? (
          <Side
            name={opp.name ?? (opp.username ? `@${opp.username}` : "Rival")}
            href={opp.username ? `/u/${opp.username}` : undefined}
            image={opp.image}
            fighter={theirFighter}
            method={label(opp.method)}
            conf={stars(opp.confidence)}
            align="right"
          />
        ) : (
          <p className="animate-pulse text-right text-[0.7rem] text-fog">Finding an opponent to take {theirFighter}…</p>
        )}
      </div>

      <div className="mt-3 flex items-center justify-between gap-2">
        <span className="inline-flex items-center gap-1 text-[0.65rem] uppercase tracking-wider text-fog">
          Settles in <Countdown date={fightDate} compact />
        </span>
        <div className="flex items-center gap-2">
          <button
            type="button"
            disabled
            title="Voice Debate — coming soon"
            className="inline-flex cursor-not-allowed items-center gap-1 rounded-lg border border-ink-700 px-2.5 py-1.5 text-[0.7rem] font-semibold text-fog/60"
          >
            <Mic className="size-3.5" /> Voice · soon
          </button>
          <Link href={discussionHref} className="rounded-lg bg-blood-500 px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-blood-600">
            Debate it
          </Link>
        </div>
      </div>
    </div>
  );
}
