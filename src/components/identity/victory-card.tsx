import Image from "next/image";
import Link from "next/link";
import { Trophy, Flame, Target, Crown, Check, X } from "lucide-react";
import type { VictoryCard as VictoryCardData } from "@/lib/identity/victory-card";
import { methodLabel } from "@/components/forums/pick-identity";
import { cn } from "@/lib/utils";

// ── Prediction Victory Card (on-screen) ─────────────────────────────────────
// The collectible a user sees in-app — premium, dark, vertical for phone
// sharing. Fighter photos live HERE (they load fine in the browser); the OG
// share image is deliberately text/stat only (see src/lib/og.tsx). Motion is a
// single CSS fade-rise on mount — no confetti, no casino. Every value shown is
// real and passed from getVictoryCard; nothing is fabricated, and a stat that
// doesn't exist is simply not rendered.

const RARITY_LABEL: Record<string, string> = {
  LEGEND: "Legend", CHAMPION: "Champion", EPIC: "Epic", RARE: "Rare", BASE: "Call",
};

function initials(name: string): string {
  return name.trim().split(/\s+/).slice(0, 2).map((w) => w[0]?.toUpperCase() ?? "").join("") || "?";
}

export function VictoryCard({ card }: { card: VictoryCardData }) {
  const win = card.pick.correct;
  const round = card.fight.roundEnded ? `R${card.fight.roundEnded}` : null;
  const method = methodLabel(card.fight.method);
  const finish = [method, round].filter(Boolean).join(" · ");

  return (
    <article
      // The single, subtle entrance. `motion-safe` respects reduced-motion.
      className="cr-victory mx-auto w-full max-w-md overflow-hidden rounded-3xl border border-ink-800 bg-ink-950 shadow-2xl shadow-black/50"
      style={{
        // Tone the top glow to the outcome — a won call breathes volt/gold, a
        // lost one stays cool. Uses the same radial idiom as the result reveal.
        backgroundImage: win
          ? "radial-gradient(130% 80% at 50% 0%, rgba(225,29,42,0.22), transparent 60%)"
          : "radial-gradient(130% 80% at 50% 0%, rgba(56,72,96,0.28), transparent 62%)",
      }}
    >
      {/* Eyebrow — rarity + event, the "what card is this" line */}
      <div className="flex items-center justify-between px-6 pt-6">
        <span className={cn(
          "inline-flex items-center gap-1.5 rounded-md border px-2 py-0.5 text-[0.62rem] font-bold uppercase tracking-[0.18em]",
          card.rarity === "CHAMPION" || card.rarity === "LEGEND"
            ? "border-gold-500/40 bg-gold-500/12 text-gold-300"
            : "border-ink-700 bg-ink-800/60 text-fog",
        )}>
          {(card.rarity === "CHAMPION" || card.rarity === "LEGEND") && <Crown className="size-3" />}
          {RARITY_LABEL[card.rarity] ?? "Call"}
        </span>
        {card.fight.promotion && (
          <span className="truncate text-[0.62rem] font-semibold uppercase tracking-[0.18em] text-fog">
            {card.fight.promotion}
          </span>
        )}
      </div>

      {/* Headline — the hero line */}
      <div className="px-6 pt-4">
        <h1 className="font-display text-3xl font-black uppercase leading-[1.02] tracking-tight text-chalk">
          {card.headline.text}
        </h1>
        {card.fight.eventName && (
          <p className="mt-1.5 text-sm text-fog">
            {card.fight.redName} vs {card.fight.blueName}
            <span className="text-ink-600"> · </span>{card.fight.eventName}
          </p>
        )}
      </div>

      {/* Called fighter — photo, name, verdict */}
      <div className="mx-6 mt-5 flex items-center gap-4 rounded-2xl border border-ink-800 bg-ink-900/70 p-4">
        <div className={cn(
          "relative size-16 shrink-0 overflow-hidden rounded-2xl ring-2",
          win ? "ring-volt-400/60" : "ring-ink-700",
        )}>
          {card.pick.calledImage ? (
            <Image src={card.pick.calledImage} alt={card.pick.calledName} fill className="object-cover" unoptimized />
          ) : (
            <span className="flex size-full items-center justify-center bg-gradient-to-br from-blood-600 to-blood-900 font-display text-xl font-black text-white">
              {initials(card.pick.calledName)}
            </span>
          )}
          <span className={cn(
            "absolute -bottom-1 -right-1 grid size-6 place-items-center rounded-full border-2 border-ink-950",
            win ? "bg-volt-400 text-ink-950" : "bg-blood-500 text-white",
          )}>
            {win ? <Check className="size-3.5" strokeWidth={3} /> : <X className="size-3.5" strokeWidth={3} />}
          </span>
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-[0.62rem] font-bold uppercase tracking-[0.18em] text-fog">Your call</p>
          <p className="truncate font-display text-lg font-black text-chalk">{card.pick.calledName}</p>
          <p className={cn("text-xs font-semibold", win ? "text-volt-400" : "text-fog")}>
            {win ? "Won" : "Lost"}{finish ? ` · ${finish}` : ""}
            {card.pick.confidence ? <span className="text-gold-400"> · {"★".repeat(card.pick.confidence)}</span> : null}
          </p>
        </div>
      </div>

      {/* Stat row — only the values that exist */}
      <div className="mx-6 mt-4 grid grid-cols-3 gap-2.5">
        {card.repGained > 0 && (
          <Tile icon={<Trophy className="size-3.5 text-gold-400" />} value={`+${card.repGained}`} label="Reputation" />
        )}
        {card.streak !== null && card.streak >= 2 && (
          <Tile icon={<Flame className="size-3.5 text-blood-400" />} value={String(card.streak)} label="Win streak" />
        )}
        {card.user.accuracy !== null && (
          <Tile icon={<Target className="size-3.5 text-volt-400" />} value={`${card.user.accuracy}%`} label="Accuracy" />
        )}
        {card.user.percentile !== null && (
          <Tile icon={<Crown className="size-3.5 text-gold-400" />} value={`Top ${card.user.percentile}%`} label="Callers" />
        )}
      </div>

      {/* Social proof — the "I'm good at this" line */}
      {card.socialProof && (
        <p className="mx-6 mt-4 rounded-xl border border-ink-800 bg-ink-900/60 px-4 py-2.5 text-center text-sm text-mist">
          {card.socialProof}
        </p>
      )}

      {/* Footer — whose call, and the wordmark that turns a share into acquisition */}
      <Link
        href={`/u/${card.user.username}`}
        className="mt-5 flex items-center gap-3 border-t border-ink-800 bg-ink-900/50 px-6 py-4 transition-colors hover:bg-ink-900"
      >
        <span className="size-8 shrink-0 overflow-hidden rounded-full ring-1 ring-ink-700">
          {card.user.image ? (
            <Image src={card.user.image} alt="" width={32} height={32} className="size-full object-cover" unoptimized />
          ) : (
            <span className="flex size-full items-center justify-center bg-gradient-to-br from-blood-500 to-blood-800 text-[0.7rem] font-black text-white">
              {initials(card.user.name)}
            </span>
          )}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-bold text-chalk">{card.user.name}</span>
          <span className="block text-[0.7rem] text-fog">{card.user.reputation.toLocaleString()} reputation{card.user.rank ? ` · #${card.user.rank}` : ""}</span>
        </span>
        <span className="shrink-0 font-display text-[0.6rem] font-bold uppercase tracking-[0.2em] text-fog">Combat Reviews</span>
      </Link>
    </article>
  );
}

function Tile({ icon, value, label }: { icon: React.ReactNode; value: string; label: string }) {
  return (
    <div className="rounded-xl border border-ink-800 bg-ink-900/70 px-2 py-2.5 text-center">
      <span className="flex items-center justify-center">{icon}</span>
      <p className="mt-1 font-display text-lg font-black tabular-nums leading-none text-chalk">{value}</p>
      <p className="mt-1 text-[0.58rem] uppercase tracking-wider text-fog">{label}</p>
    </div>
  );
}
