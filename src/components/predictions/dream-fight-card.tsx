"use client";

import { useState } from "react";
import Link from "next/link";
import { cn } from "@/lib/utils";
import type { CommunityMarketView } from "@/features/predictions/community/types";
import { Chip, ConsensusBar, Portrait, fmtNum, postVote, voteShares } from "@/components/predictions/shared";

/** Split a "Fighter A vs Fighter B" title into its two sides. */
function sides(title: string): [string, string] | null {
  const parts = title.split(/\s+vs\.?\s+/i);
  return parts.length === 2 ? [parts[0].trim(), parts[1].trim()] : null;
}

/**
 * "Make This Fight" — dream-matchup card. Treats each rumoured bout as an event:
 * large versus presentation, a momentum meter, and community confidence on
 * whether it actually gets made.
 */
export function DreamFightCard({
  market,
  canVote,
  onVote,
}: {
  market: CommunityMarketView;
  canVote: boolean;
  onVote: (m: CommunityMarketView) => void;
}) {
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const shares = voteShares(market);
  const will = market.options.find((o) => o.id === "will") ?? market.options[0];
  const wont = market.options.find((o) => o.id === "wont") ?? market.options[1];
  const willPct = shares[will.id] ?? 50;
  const pair = sides(market.title);
  const closed = market.status !== "open";

  async function vote(choice: string) {
    if (!canVote || closed || pending) return;
    setError(null);
    setPending(choice);
    const r = await postVote(market.id, choice);
    if (r.ok) onVote(r.market);
    else setError(r.error);
    setPending(null);
  }

  return (
    <article className="glass pred-card overflow-hidden rounded-2xl">
      {/* Gold-tinted event header */}
      <div className="relative bg-gradient-to-b from-gold-500/10 to-transparent px-4 pt-3">
        <div className="flex items-center gap-1.5">
          <Chip tone="neutral">{market.sport}</Chip>
          {market.subtitle && <span className="truncate text-[0.62rem] font-semibold uppercase tracking-wide text-fog">{market.subtitle}</span>}
          {market.statusLabel && <Chip tone="gold" className="ml-auto">{market.statusLabel}</Chip>}
        </div>

        {/* Versus */}
        <div className="mt-3 flex items-center justify-center gap-3 pb-1">
          <div className="flex flex-1 flex-col items-center text-center">
            <Portrait name={pair ? pair[0] : market.title} tone="red" size="lg" leading={willPct >= 50} />
            <div className="mt-1.5 line-clamp-2 font-display text-sm font-bold leading-tight text-chalk">
              {pair ? pair[0] : market.title}
            </div>
          </div>
          <div className="flex flex-col items-center">
            <span className="font-display text-lg font-black italic text-blood-500">VS</span>
          </div>
          <div className="flex flex-1 flex-col items-center text-center">
            <Portrait name={pair ? pair[1] : ""} tone="blue" size="lg" />
            <div className="mt-1.5 line-clamp-2 font-display text-sm font-bold leading-tight text-chalk">
              {pair ? pair[1] : ""}
            </div>
          </div>
        </div>
      </div>

      <div className="px-4 pb-4 pt-1">
        {market.description && <p className="mt-2 text-[0.8rem] leading-relaxed text-mist">{market.description}</p>}

        {/* Momentum meter */}
        <div className="mt-3">
          <ConsensusBar leftLabel="Will happen" leftPct={willPct} rightLabel="Won't happen" rightPct={100 - willPct} />
        </div>
        <p className="mt-2 text-[0.72rem] font-medium text-mist">
          {market.voteCount > 0 ? (
            <>
              <span className="text-chalk">{willPct}%</span> of {fmtNum(market.voteCount)} fan{market.voteCount === 1 ? "" : "s"} think this gets made
            </>
          ) : (
            "Do you think this fight actually happens?"
          )}
        </p>

        {/* Will / Won't */}
        <div className="mt-3 grid grid-cols-2 gap-2">
          {[will, wont].map((o) => {
            const picked = market.myVote === o.id;
            const disabled = !canVote || closed || pending !== null;
            const yes = o.id === "will";
            return (
              <button
                key={o.id}
                disabled={disabled}
                onClick={() => vote(o.id)}
                aria-pressed={picked}
                className={cn(
                  "tap min-h-11 rounded-xl border py-2.5 text-[0.72rem] font-bold uppercase tracking-wide",
                  picked
                    ? yes ? "border-up bg-up/15 text-up" : "border-blood-500 bg-blood-500/15 text-blood-300"
                    : disabled ? "border-ink-800 bg-ink-850 text-fog"
                      : yes ? "border-ink-700 bg-ink-800 text-mist hover:border-up/50 hover:text-chalk"
                        : "border-ink-700 bg-ink-800 text-mist hover:border-blood-500/50 hover:text-chalk",
                )}
              >
                {pending === o.id ? "…" : o.label}
              </button>
            );
          })}
        </div>

        <div className="mt-3 flex items-center justify-between border-t border-ink-800/70 pt-2.5">
          <span className="text-[0.66rem] font-medium text-fog">
            {fmtNum(market.voteCount)} vote{market.voteCount === 1 ? "" : "s"}
          </span>
          <Link href="/community" className="tap text-[0.68rem] font-semibold text-mist hover:text-chalk">
            Discuss →
          </Link>
        </div>

        {error && <p className="mt-2 text-center text-[0.68rem] font-semibold text-blood-300">{error}</p>}
        {!canVote && (
          <Link href="/account" className="mt-2 block text-center text-[0.68rem] font-semibold text-blood-300">
            Sign in to vote
          </Link>
        )}
      </div>
    </article>
  );
}
