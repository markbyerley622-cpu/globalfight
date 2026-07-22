"use client";

import { useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { Share2, Check } from "lucide-react";
import { cn } from "@/lib/utils";
import type { PredictionMarket } from "@/features/predictions/types";
import type { CommunityOption, MarketVote } from "@/features/predictions/community/types";
import { Chip, CloseTimer, ConsensusBar, Portrait, fmtNum, initials, pct, marketDivergence, sharePrediction } from "@/components/predictions/shared";

const isYesNo = (labels: string[]) =>
  labels.length === 2 && labels.every((l) => /^(yes|no)$/i.test(l.trim()));

const fighterHref = (name: string) => `/fighters?q=${encodeURIComponent(name.trim())}`;

export type MarketVoteFn = (choice: string, kind: string, options: CommunityOption[]) => Promise<void> | void;

/**
 * Live prediction card. Market probability up top (event/fighters/odds/close),
 * then the Combat Register community vote below — who-wins for head-to-head,
 * Yes/No/Maybe for props. The community percentages reveal once you've voted.
 */
export function MarketCard({
  market,
  community,
  canVote = false,
  onVote,
}: {
  market: PredictionMarket;
  community?: MarketVote;
  canVote?: boolean;
  onVote?: MarketVoteFn;
}) {
  const sorted = [...market.outcomes].sort((a, b) => b.probability - a.probability);
  const fav = sorted[0];
  const under = sorted[1] ?? { label: "Field", probability: Math.max(0, 1 - (fav?.probability ?? 0)) };
  const favPct = pct(fav?.probability ?? 0);
  const underPct = market.outcomes.length === 2 ? 100 - favPct : pct(under.probability);
  const headToHead = market.outcomes.length === 2 && !isYesNo(market.outcomes.map((o) => o.label));
  const closed = market.status !== "open";

  return (
    <article
      className={cn(
        "glass pred-card flex h-full flex-col overflow-hidden rounded-2xl",
        market.featured && "ring-featured",
        closed && "opacity-70",
      )}
    >
      {/* Badge strip */}
      <div className="flex flex-wrap items-center gap-1.5 px-4 pt-3.5">
        <Chip tone="neutral">{market.sport}</Chip>
        {market.league && <Chip tone="outline">{market.league}</Chip>}
        {market.featured && <Chip tone="gold">★ Featured</Chip>}
        {market.hot && <Chip tone="hot">🔥 Hot</Chip>}
        <div className="ml-auto flex items-center gap-1.5">
          {!closed && <CloseTimer closesAt={market.closesAt} />}
          {closed && <Chip tone="outline">Closed</Chip>}
          <ShareButton market={market} community={community} favLabel={fav?.label ?? ""} favPct={favPct} />
        </div>
      </div>

      {/* Subject */}
      {headToHead ? (
        <div className="flex items-stretch gap-2 px-4 pt-4">
          <Link href={fighterHref(fav.label)} className="group flex flex-1 flex-col items-center text-center">
            <Portrait name={fav.label} tone="red" leading />
            <div className="mt-1.5 line-clamp-2 font-display text-sm font-bold leading-tight text-chalk transition-colors group-hover:text-blood-300">
              {fav.label}
            </div>
            <div className="mt-0.5 text-[0.58rem] font-semibold uppercase tracking-wide text-up">Favourite</div>
          </Link>
          <div className="flex items-center px-1">
            <span className="font-display text-sm font-bold italic text-fog">VS</span>
          </div>
          <Link href={fighterHref(under.label)} className="group flex flex-1 flex-col items-center text-center">
            <Portrait name={under.label} tone="blue" />
            <div className="mt-1.5 line-clamp-2 font-display text-sm font-bold leading-tight text-chalk transition-colors group-hover:text-volt-400">
              {under.label}
            </div>
            <div className="mt-0.5 text-[0.58rem] font-semibold uppercase tracking-wide text-fog">Underdog</div>
          </Link>
        </div>
      ) : (
        <div className="flex items-start gap-3 px-4 pt-4">
          {market.image ? (
            <Image src={market.image} alt="" width={48} height={48} className="size-12 shrink-0 rounded-lg object-cover ring-1 ring-ink-700" unoptimized />
          ) : (
            <div className="grid size-12 shrink-0 place-items-center rounded-lg bg-ink-800 font-display text-sm font-bold text-fog">
              {initials(market.title)}
            </div>
          )}
          <div className="min-w-0 pt-0.5">
            <h3 className="font-display text-[0.98rem] font-bold leading-tight text-chalk">{market.title}</h3>
          </div>
        </div>
      )}

      {/* Market probability */}
      <div className="px-4 pb-3.5 pt-4">
        <ConsensusBar leftLabel={fav?.label ?? "—"} leftPct={favPct} rightLabel={under.label} rightPct={underPct} size="lg" />
      </div>

      {/* Combat Register community vote (fills to the bottom) */}
      <div className="mt-auto">
        <CommunityVote
          market={market}
          headToHead={headToHead}
          community={community}
          canVote={canVote}
          onVote={onVote}
        />
      </div>
    </article>
  );
}

function CommunityVote({
  market,
  headToHead,
  community,
  canVote,
  onVote,
}: {
  market: PredictionMarket;
  headToHead: boolean;
  community?: MarketVote;
  canVote: boolean;
  onVote?: MarketVoteFn;
}) {
  const [pending, setPending] = useState<string | null>(null);

  // Stable vote options: fighters (by original outcome order) or Yes/No/Maybe.
  const kind = headToHead ? "who_wins" : "prop_ynm";
  const options: CommunityOption[] = headToHead
    ? market.outcomes.map((o) => ({ id: o.id, label: o.label }))
    : [{ id: "yes", label: "Yes" }, { id: "no", label: "No" }, { id: "maybe", label: "Maybe" }];

  const voteCount = community?.voteCount ?? 0;
  const myVote = community?.myVote ?? null;
  const tally = community?.tally ?? {};
  const total = Object.values(tally).reduce((a, b) => a + b, 0);
  const share = (id: string) => (total ? Math.round(((tally[id] ?? 0) / total) * 100) : 0);
  const div = marketDivergence(market, community);
  const controversial = div ? Math.abs(div.delta) >= 15 : false;

  async function cast(choice: string) {
    if (!canVote || pending || !onVote) return;
    setPending(choice);
    try { await onVote(choice, kind, options); } finally { setPending(null); }
  }

  const voteButtons = (
    <div className={cn("grid gap-1.5", headToHead ? "grid-cols-2" : "grid-cols-3")}>
      {options.map((o) => (
        <button
          key={o.id}
          disabled={!canVote || pending !== null}
          onClick={() => cast(o.id)}
          className={cn(
            "tap min-h-9 truncate rounded-lg border px-1.5 py-2 font-semibold",
            headToHead ? "text-[0.72rem]" : "text-[0.68rem] uppercase tracking-wide",
            !canVote ? "border-ink-800 bg-ink-850 text-fog" : "border-ink-700 bg-ink-800 text-mist hover:border-up/50 hover:text-chalk",
          )}
        >
          {pending === o.id ? "…" : o.label}
        </button>
      ))}
    </div>
  );

  return (
    <div className="border-t border-ink-800/70 px-4 py-3">
      <div className="mb-2 flex items-center justify-between">
        <span className="inline-flex items-center gap-1.5 text-[0.6rem] font-bold uppercase tracking-[0.14em] text-blood-400">
          <span className="grid size-3.5 place-items-center rounded-[3px] bg-blood-500 text-[0.5rem] text-white">C</span>
          Fight Pulse
        </span>
        <div className="flex items-center gap-1.5">
          {controversial && (
            <span className="rounded bg-gold-500/15 px-1.5 py-0.5 text-[0.55rem] font-bold uppercase tracking-wide text-gold-300">⚡ Controversial</span>
          )}
          {voteCount > 0 && (
            <span className="text-[0.62rem] font-medium text-fog">{fmtNum(voteCount)} vote{voteCount === 1 ? "" : "s"}</span>
          )}
        </div>
      </div>

      {voteCount > 0 ? (
        <>
          {headToHead ? (
            <ConsensusBar leftLabel={options[0].label} leftPct={share(options[0].id)} rightLabel={options[1].label} rightPct={share(options[1].id)} size="sm" />
          ) : (
            <div className="space-y-1.5">
              {options.map((o) => {
                const mine = myVote === o.id;
                return (
                  <div key={o.id}>
                    <div className="mb-0.5 flex items-center justify-between text-[0.66rem] font-semibold">
                      <span className={mine ? "text-up" : "text-mist"}>{o.label}{mine ? " · your pick" : ""}</span>
                      <span className="text-fog">{share(o.id)}%</span>
                    </div>
                    <div className="h-1.5 overflow-hidden rounded-full bg-ink-700">
                      <div className={cn("prob-fill h-full rounded-full", mine ? "bg-up" : "bg-up/50")} style={{ width: `${share(o.id)}%` }} />
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* Fight Pulse vs The Market — the divergence nobody else can show. */}
          {div && (
            <div className="mt-2.5 rounded-lg border border-ink-700/70 bg-ink-950/40 px-2.5 py-2">
              <div className="flex items-center justify-between text-[0.66rem]">
                <span className="text-mist">Fans <b className="text-chalk">{div.commPct}%</b> {div.label}</span>
                <span className="text-mist">Market <b className="text-chalk">{div.marketPct}%</b></span>
              </div>
              <div className={cn("mt-1 text-center text-[0.64rem] font-bold", div.delta >= 0 ? "text-up" : "text-blood-300")}>
                {div.delta >= 0 ? "▲ +" : "▼ −"}{Math.abs(div.delta)}% {div.delta >= 0 ? "more" : "less"} confident than the market
              </div>
            </div>
          )}

          <div className="mt-2.5">
            {myVote ? (
              <p className="text-center text-[0.66rem] font-semibold text-up">Your pick: {options.find((o) => o.id === myVote)?.label}</p>
            ) : canVote ? (
              voteButtons
            ) : (
              <Link href="/account" className="block text-center text-[0.64rem] font-semibold text-blood-300">Sign in to vote</Link>
            )}
          </div>
        </>
      ) : (
        <>
          <div className="mb-1.5 text-[0.66rem] font-medium text-mist">{headToHead ? "Who you got?" : "Will it happen?"}</div>
          {voteButtons}
          {!canVote && (
            <Link href="/account" className="mt-1.5 block text-center text-[0.64rem] font-semibold text-blood-300">Sign in to vote</Link>
          )}
        </>
      )}
    </div>
  );
}

function ShareButton({ market, community, favLabel, favPct }: { market: PredictionMarket; community?: MarketVote; favLabel: string; favPct: number }) {
  const [copied, setCopied] = useState(false);
  async function onShare() {
    const d = marketDivergence(market, community);
    const text = d
      ? `${market.title} — Fight Pulse: fans ${d.commPct}% vs market ${d.marketPct}% on ${d.label} (${d.delta >= 0 ? "+" : "−"}${Math.abs(d.delta)}%). Combat Reviews.`
      : `${market.title} — the market has ${favLabel} at ${favPct}%. What's your call? Combat Reviews.`;
    const url = market.sourceUrl ?? (typeof window !== "undefined" ? `${window.location.origin}/predictions` : "");
    const r = await sharePrediction(market.title, text, url);
    if (r === "copied") { setCopied(true); setTimeout(() => setCopied(false), 1600); }
  }
  return (
    <button onClick={onShare} aria-label="Share this prediction" className="tap grid size-6 place-items-center rounded-md border border-ink-700 text-fog transition-colors hover:border-ink-600 hover:text-chalk">
      {copied ? <Check className="size-3 text-up" /> : <Share2 className="size-3" />}
    </button>
  );
}
