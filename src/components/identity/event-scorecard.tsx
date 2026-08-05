import Image from "next/image";
import Link from "next/link";
import { Check, X, Trophy, Layers, Crown, TrendingUp } from "lucide-react";
import type { EventScorecard as ScorecardData } from "@/lib/identity/scorecard";
import { BADGE_TIER_CLASS } from "@/components/identity/victory-card";
import { cn } from "@/lib/utils";

// ── Event Scorecard (on-screen) ─────────────────────────────────────────────
// The shareable "how my night went". Hierarchy per the identity doctrine: hero
// (the record) → achievement (badges) → impact (rep/cards/standing) → the story
// (per-bout ticks) → identity footer. One CSS fade-rise (reuses cr-victory).
// Every value is the user's own graded record; nothing about the fights is
// invented.

function initials(name: string): string {
  return name.trim().split(/\s+/).slice(0, 2).map((w) => w[0]?.toUpperCase() ?? "").join("") || "?";
}

export function EventScorecard({ card }: { card: ScorecardData }) {
  const standing = [
    card.user.percentile !== null ? `Top ${card.user.percentile}%` : null,
    card.user.rank ? `#${card.user.rank.toLocaleString()}` : null,
  ].filter(Boolean).join(" · ");

  return (
    <article
      className="cr-victory mx-auto w-full max-w-md overflow-hidden rounded-3xl border border-ink-800 bg-ink-950 shadow-2xl shadow-black/50"
      style={{
        backgroundImage: card.perfect
          ? "radial-gradient(135% 80% at 50% -8%, rgba(214,164,58,0.26), transparent 60%)"
          : "radial-gradient(135% 80% at 50% -8%, rgba(225,29,42,0.20), transparent 60%)",
      }}
    >
      {/* Header */}
      <div className="flex items-center justify-between px-6 pt-6 text-3xs font-black uppercase tracking-[0.2em] text-fog">
        <span>{card.event.promotion ?? "Scorecard"}</span>
        <span>{card.event.name}</span>
      </div>

      {/* Hero — the record is the hero number */}
      <div className="flex items-end gap-4 px-6 pt-3">
        <p className="font-display text-6xl font-black leading-none tabular-nums text-chalk">
          {card.correct}<span className="text-3xl text-fog">/{card.graded}</span>
        </p>
        <div className="pb-1">
          <p className={cn("font-display text-2xl font-black uppercase leading-none tracking-tight", card.perfect ? "text-gold-300" : "text-chalk")}>
            {card.headline}
          </p>
          <p className="mt-1 text-xs text-fog">{card.accuracy}% called right</p>
        </div>
      </div>

      {/* Achievements */}
      {card.badges.length > 0 && (
        <div className="mt-4 flex flex-wrap gap-2 px-6">
          {card.badges.map((b) => (
            <span key={b.label} className={cn("inline-flex items-center rounded-full border px-3 py-1.5 text-2xs font-bold", BADGE_TIER_CLASS[b.tier])}>
              {b.label}
            </span>
          ))}
        </div>
      )}

      {/* Impact — what the night moved */}
      <div className="mx-6 mt-4 flex items-center gap-2 rounded-card border border-gold-500/25 bg-gold-500/[0.06] px-4 py-3">
        {card.repGained > 0 && (
          <span className="inline-flex items-center gap-1.5 font-display text-lg font-black text-chalk">
            <TrendingUp className="size-4 text-gold-400" />+{card.repGained}
            <span className="text-sm font-bold text-gold-300">rep</span>
          </span>
        )}
        {card.cardsEarned > 0 && (
          <span className="ml-auto inline-flex items-center gap-1 text-sm font-bold text-volt-300">
            <Layers className="size-3.5" />{card.cardsEarned} card{card.cardsEarned === 1 ? "" : "s"}
          </span>
        )}
        {standing && (
          <span className={cn("inline-flex items-center gap-1 text-sm font-bold text-gold-300", card.cardsEarned > 0 ? "" : "ml-auto")}>
            <Crown className="size-3.5" />{standing}
          </span>
        )}
      </div>

      {/* The story — per-bout ticks. Truth: which fighter they called, and whether
          it landed. No round/finish narrative that the data can't support. */}
      <ul className="mx-6 mt-4 divide-y divide-ink-800 overflow-hidden rounded-card border border-ink-800">
        {card.bouts.map((b, i) => (
          <li key={i} className="flex items-center gap-3 bg-ink-900/60 px-3.5 py-2.5">
            <span className={cn("grid size-5 shrink-0 place-items-center rounded-full", b.correct ? "bg-volt-400 text-ink-950" : "bg-ink-700 text-fog")}>
              {b.correct ? <Check className="size-3" strokeWidth={3} /> : <X className="size-3" strokeWidth={3} />}
            </span>
            <span className="min-w-0 flex-1 truncate text-sm">
              <span className={cn("font-bold", b.correct ? "text-chalk" : "text-fog")}>{b.fighterCalled}</span>
              <span className="text-fog"> vs {b.opponent}</span>
            </span>
            {b.main && <span className="shrink-0 text-4xs font-bold uppercase tracking-wider text-gold-400">Main</span>}
          </li>
        ))}
      </ul>

      {/* Identity footer */}
      <Link href={`/u/${card.user.username}`} className="mt-5 flex items-center gap-3 border-t border-ink-800 bg-ink-900/50 px-6 py-4 transition-colors hover:bg-ink-900">
        <span className="size-8 shrink-0 overflow-hidden rounded-full ring-1 ring-ink-700">
          {card.user.image ? (
            <Image src={card.user.image} alt="" width={32} height={32} className="size-full object-cover" unoptimized />
          ) : (
            <span className="flex size-full items-center justify-center bg-gradient-to-br from-blood-500 to-blood-800 text-2xs font-black text-white">{initials(card.user.name)}</span>
          )}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-bold text-chalk">{card.user.name}</span>
          <span className="block truncate text-2xs text-fog">{card.user.reputation.toLocaleString()} reputation{card.user.rank ? ` · #${card.user.rank}` : ""}</span>
        </span>
        <span className="shrink-0 font-display text-3xs font-black uppercase tracking-[0.22em] text-fog">Combat Reviews</span>
      </Link>
    </article>
  );
}
