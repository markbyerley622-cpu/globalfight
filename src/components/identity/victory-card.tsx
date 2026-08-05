import Image from "next/image";
import Link from "next/link";
import { Flame, Crown, Check, X, TrendingUp } from "lucide-react";
import type { VictoryCard as VictoryCardData } from "@/lib/identity/victory-card";
import type { BadgeTier } from "@/lib/identity/victory-badges";
import { methodLabel } from "@/components/forums/pick-identity";
import { cn } from "@/lib/utils";

// ── Prediction Victory Card (on-screen) ─────────────────────────────────────
// The collectible a user posts because it raises their standing. It answers the
// five things in three seconds: I made this call · it was hard · I was right ·
// it moved my standing · can you beat me. Fighter photo lives here (the browser
// loads it); the OG share image is its own render (src/lib/og.tsx). One subtle
// CSS fade-rise, reduced-motion safe. Every value is real — a stat or badge that
// isn't provable is simply absent, never faked.

const RARITY: Record<string, { label: string; ring: string; text: string; glow: string }> = {
  LEGEND:   { label: "Legend",   ring: "border-gold-500/50 bg-gold-500/15",   text: "text-gold-300", glow: "rgba(214,164,58,0.30)" },
  CHAMPION: { label: "Champion", ring: "border-gold-500/50 bg-gold-500/15",   text: "text-gold-300", glow: "rgba(214,164,58,0.28)" },
  EPIC:     { label: "Epic",     ring: "border-volt-500/50 bg-volt-500/12",   text: "text-volt-300", glow: "rgba(56,189,248,0.22)" },
  RARE:     { label: "Rare",     ring: "border-blood-500/50 bg-blood-500/12", text: "text-blood-300", glow: "rgba(225,29,42,0.24)" },
  BASE:     { label: "Called",   ring: "border-ink-700 bg-ink-800/60",        text: "text-fog",      glow: "rgba(225,29,42,0.20)" },
};

// Badge styling by tier — elite badges are meant to catch the eye first.
// Exported so the Event Scorecard renders its badges identically (one source).
export const BADGE_TIER_CLASS: Record<BadgeTier, string> = {
  elite:  "border-gold-500/45 bg-gold-500/12 text-gold-200",
  strong: "border-volt-500/35 bg-volt-500/10 text-volt-200",
  base:   "border-ink-700 bg-ink-800/60 text-mist",
};

function initials(name: string): string {
  return name.trim().split(/\s+/).slice(0, 2).map((w) => w[0]?.toUpperCase() ?? "").join("") || "?";
}

export function VictoryCard({ card }: { card: VictoryCardData }) {
  const win = card.pick.correct;
  const rarity = RARITY[card.rarity] ?? RARITY.BASE;
  const round = card.fight.roundEnded ? `R${card.fight.roundEnded}` : null;
  const finish = [methodLabel(card.fight.method), round].filter(Boolean).join(" · ");
  // Footer identity line — each fact appears exactly once on the card: the
  // achievements live in the badge stack, so the footer carries the durable
  // standing (total reputation, career accuracy, rank).
  const footer = [
    `${card.user.reputation.toLocaleString()} reputation`,
    card.user.accuracy !== null ? `${card.user.accuracy}% accuracy` : null,
    card.user.rank ? `#${card.user.rank.toLocaleString()}` : null,
  ].filter(Boolean).join(" · ");

  return (
    <article
      className="cr-victory mx-auto w-full max-w-md overflow-hidden rounded-3xl border border-ink-800 bg-ink-950 shadow-2xl shadow-black/50"
      style={{
        // Top glow toned to the rarity on a win, cool on a loss.
        backgroundImage: win
          ? `radial-gradient(135% 80% at 50% -8%, ${rarity.glow}, transparent 60%)`
          : "radial-gradient(135% 80% at 50% -8%, rgba(56,72,96,0.28), transparent 62%)",
      }}
    >
      {/* Header — rarity tier + promotion */}
      <div className="flex items-center justify-between px-6 pt-6">
        <span className={cn("inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-3xs font-black uppercase tracking-[0.2em]", rarity.ring, rarity.text)}>
          {(card.rarity === "CHAMPION" || card.rarity === "LEGEND") && <Crown className="size-3" />}
          {rarity.label}
        </span>
        {card.fight.promotion && (
          <span className="truncate pl-3 text-3xs font-semibold uppercase tracking-[0.2em] text-fog">{card.fight.promotion}</span>
        )}
      </div>

      {/* Hero headline */}
      <div className="px-6 pt-4">
        <h1 className="font-display text-[2rem] font-black uppercase leading-[0.98] tracking-tight text-chalk">
          {card.headline.text}
        </h1>
        <p className="mt-2 text-sm text-fog">
          {card.fight.redName} vs {card.fight.blueName}
          {card.fight.eventName && <><span className="text-ink-600"> · </span>{card.fight.eventName}</>}
        </p>
      </div>

      {/* Verdict — who they called + result */}
      <div className="mx-6 mt-5 flex items-center gap-4 rounded-card border border-ink-800 bg-ink-900/70 p-4">
        <div className={cn("relative size-16 shrink-0 overflow-hidden rounded-squircle ring-2", win ? "ring-volt-400/60" : "ring-ink-700")}>
          {card.pick.calledImage ? (
            <Image src={card.pick.calledImage} alt={card.pick.calledName} fill className="object-cover" unoptimized />
          ) : (
            <span className="flex size-full items-center justify-center bg-gradient-to-br from-blood-600 to-blood-900 font-display text-xl font-black text-white">
              {initials(card.pick.calledName)}
            </span>
          )}
          <span className={cn("absolute -bottom-1 -right-1 grid size-6 place-items-center rounded-full border-2 border-ink-950", win ? "bg-volt-400 text-ink-950" : "bg-blood-500 text-white")}>
            {win ? <Check className="size-3.5" strokeWidth={3} /> : <X className="size-3.5" strokeWidth={3} />}
          </span>
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-3xs font-bold uppercase tracking-[0.2em] text-fog">Your call</p>
          <p className="truncate font-display text-xl font-black text-chalk">{card.pick.calledName}</p>
          <p className={cn("text-xs font-semibold", win ? "text-volt-400" : "text-fog")}>
            {win ? "Won" : "Lost"}{finish ? ` · ${finish}` : ""}
            {card.pick.confidence ? <span className="text-gold-400"> · {"★".repeat(card.pick.confidence)}</span> : null}
          </p>
        </div>
      </div>

      {/* Achievement stack — the "why this was impressive" core. Only real ones. */}
      {card.badges.length > 0 && (
        <div className="mx-6 mt-4 flex flex-wrap gap-2">
          {card.badges.map((b) => (
            <span key={b.kind + b.label} className={cn("inline-flex items-center rounded-full border px-3 py-1.5 text-2xs font-bold", BADGE_TIER_CLASS[b.tier])}>
              {b.label}
            </span>
          ))}
        </div>
      )}

      {/* Impact — the one number that moved: reputation gained, with the live
          streak alongside. Standing/accuracy live in the footer; the crowd-beat
          and elite-tier facts live in the badges — each stated once. */}
      {win && card.repGained > 0 && (
        <div className="mx-6 mt-4 flex items-center gap-3 rounded-card border border-gold-500/25 bg-gold-500/[0.06] px-4 py-3">
          <TrendingUp className="size-5 shrink-0 text-gold-400" />
          <p className="flex-1 font-display text-lg font-black leading-none text-chalk">
            +{card.repGained} <span className="text-sm font-bold text-gold-300">reputation</span>
          </p>
          {card.streak !== null && card.streak >= 2 && (
            <span className="inline-flex shrink-0 items-center gap-1 rounded-lg border border-blood-500/30 bg-blood-500/10 px-2.5 py-1.5 text-sm font-black tabular-nums text-blood-300">
              <Flame className="size-3.5" /> {card.streak}
            </span>
          )}
        </div>
      )}

      {/* Footer — whose call + the wordmark that turns a share into acquisition */}
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
          <span className="block truncate text-2xs text-fog">{footer}</span>
        </span>
        <span className="shrink-0 font-display text-3xs font-black uppercase tracking-[0.22em] text-fog">Combat Reviews</span>
      </Link>
    </article>
  );
}
