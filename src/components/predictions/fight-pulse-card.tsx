"use client";

import { useState } from "react";
import Link from "next/link";
import { cn } from "@/lib/utils";
import type { CommunityMarketView } from "@/features/predictions/community/types";
import { Chip, ConsensusBar, Portrait, fmtNum, postVote, voteShares } from "@/components/predictions/shared";

/**
 * Community "Fight Pulse" card — native Combat Register consensus (who-wins &
 * props). Probability is the community's collective read, not a market. Tapping
 * into fan opinion is the product distinction vs. the external market feed.
 */
export function FightPulseCard({
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
  const ranked = [...market.options].sort((a, b) => (shares[b.id] ?? 0) - (shares[a.id] ?? 0));
  const [top, second] = ranked;
  const third = ranked[2];
  const headToHead = market.kind === "who_wins" && market.options.length >= 2;
  const closed = market.status !== "open";

  // Yes/No props render a fixed Yes (green) → No (red) horizontal bar, so the
  // community read is always oriented the same way regardless of which leads.
  const yesOpt = market.options.find((o) => o.id === "yes" || /^yes$/i.test(o.label));
  const noOpt = market.options.find((o) => o.id === "no" || /^no$/i.test(o.label));
  const isYesNo = market.kind === "prop" && Boolean(yesOpt && noOpt);

  async function vote(choice: string) {
    if (!canVote || closed || pending) return;
    setError(null);
    setPending(choice);
    const r = await postVote(market.id, choice);
    if (r.ok) onVote(r.market);
    else setError(r.error);
    setPending(null);
  }

  const consensus =
    market.voteCount > 0
      ? `${shares[top.id]}% of ${fmtNum(market.voteCount)} fan${market.voteCount === 1 ? "" : "s"} back ${top.label}`
      : "No votes yet — be the first to call it.";

  return (
    <article className="glass pred-card overflow-hidden rounded-2xl p-3.5">
      <div className="flex items-center gap-1.5">
        <Chip tone="live">◆ Fight Pulse</Chip>
        {market.subtitle && <span className="truncate text-[0.62rem] font-semibold uppercase tracking-wide text-fog">{market.subtitle}</span>}
        {market.statusLabel && <Chip tone="gold" className="ml-auto">{market.statusLabel}</Chip>}
      </div>

      {/* Subject */}
      {headToHead && market.options.length === 2 ? (
        <div className="mt-3 flex items-center gap-2">
          <div className="flex min-w-0 flex-1 items-center gap-2">
            <Portrait name={market.options[0].label} tone="red" leading={shares[market.options[0].id] >= shares[market.options[1].id]} />
            <div className="min-w-0 truncate font-display text-sm font-bold text-chalk">{market.options[0].label}</div>
          </div>
          <span className="font-display text-xs font-bold italic text-fog">VS</span>
          <div className="flex min-w-0 flex-1 items-center justify-end gap-2 text-right">
            <div className="min-w-0 truncate font-display text-sm font-bold text-chalk">{market.options[1].label}</div>
            <Portrait name={market.options[1].label} tone="blue" leading={shares[market.options[1].id] > shares[market.options[0].id]} />
          </div>
        </div>
      ) : (
        <h3 className="mt-2.5 font-display text-[0.95rem] font-bold leading-tight text-chalk">{market.title}</h3>
      )}

      {market.description && <p className="mt-2 line-clamp-2 text-[0.8rem] leading-relaxed text-mist">{market.description}</p>}

      {/* Consensus hero — Yes/No props use a fixed Yes→No bar; head-to-head and
          multi-way use the ranked consensus. */}
      <div className="mt-3">
        {isYesNo && yesOpt && noOpt ? (
          <ConsensusBar
            leftLabel="Yes"
            leftPct={shares[yesOpt.id]}
            rightLabel="No"
            rightPct={shares[noOpt.id]}
            size="lg"
          />
        ) : (
          <ConsensusBar
            leftLabel={top.label}
            leftPct={shares[top.id]}
            rightLabel={second?.label ?? "—"}
            rightPct={second ? shares[second.id] : 0}
            size="lg"
          />
        )}
        {!isYesNo && third && (
          <div className="mt-1.5 flex items-center justify-between text-[0.66rem] font-semibold text-fog">
            <span>{third.label}</span>
            <span>{shares[third.id]}%</span>
          </div>
        )}
      </div>

      {/* Consensus statement */}
      <p className="mt-2.5 text-[0.72rem] font-medium text-mist">
        <span className="text-chalk">{consensus.split("—")[0]}</span>
        {consensus.includes("—") ? ` —${consensus.split("—")[1]}` : ""}
      </p>

      {/* Vote buttons */}
      <div className={cn("mt-3 grid gap-2", market.options.length > 2 ? "grid-cols-3" : "grid-cols-2")}>
        {market.options.map((o) => {
          const picked = market.myVote === o.id;
          const disabled = !canVote || closed || pending !== null;
          return (
            <button
              key={o.id}
              disabled={disabled}
              onClick={() => vote(o.id)}
              aria-pressed={picked}
              className={cn(
                "tap min-h-11 rounded-xl border px-2 py-2.5 text-[0.72rem] font-bold uppercase tracking-wide",
                picked
                  ? "border-up bg-up/15 text-up"
                  : disabled
                    ? "border-ink-800 bg-ink-850 text-fog"
                    : "border-ink-700 bg-ink-800 text-mist hover:border-up/50 hover:text-chalk",
              )}
            >
              {pending === o.id ? "…" : o.label}
            </button>
          );
        })}
      </div>

      {/* Footer: activity + discuss */}
      <div className="mt-3 flex items-center justify-between border-t border-ink-800/70 pt-2.5">
        <span className="text-[0.66rem] font-medium text-fog">
          {fmtNum(market.voteCount)} fan{market.voteCount === 1 ? "" : "s"} voted
          {market.myVote && <span className="text-up"> · you&rsquo;re in</span>}
        </span>
        <Link href="/community" className="tap text-[0.68rem] font-semibold text-mist hover:text-chalk">
          Discuss →
        </Link>
      </div>

      {error && <p className="mt-2 text-center text-[0.68rem] font-semibold text-blood-300">{error}</p>}
      {!canVote && (
        <Link href="/account" className="mt-2 block text-center text-[0.68rem] font-semibold text-blood-300">
          Sign in to add your voice
        </Link>
      )}
    </article>
  );
}
