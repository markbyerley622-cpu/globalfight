import Link from "next/link";
import { Flame, Trophy, Layers } from "lucide-react";
import type { EventPickSummary } from "@/lib/profile-stats";

/**
 * The Sunday payoff. Shown at the top of a COMPLETED event when the viewer made
 * picks on its card — how they did, reputation gained, streak, cards earned.
 * Closes the loop: predict → result → reward → collection/leaderboard → next.
 */
export function ResultReveal({ summary, streak }: { summary: EventPickSummary; streak: number }) {
  return (
    <section
      aria-label="Your result"
      className="border-b border-ink-700/70 px-4 py-6 text-center"
      style={{ backgroundImage: "radial-gradient(120% 90% at 50% 0%, color-mix(in srgb, var(--accent, #e11d2a) 18%, transparent), transparent 70%)" }}
    >
      <p className="text-[0.65rem] font-bold uppercase tracking-[0.3em] text-fog">You went</p>
      <p className="mt-1 font-display text-5xl font-black tabular-nums text-chalk">
        {summary.correct}<span className="text-fog">/{summary.graded}</span>
      </p>
      <p className="mt-1 font-display text-lg font-bold text-blood-300">{summary.accuracy}% called right</p>

      <div className="mx-auto mt-4 flex max-w-md flex-wrap items-center justify-center gap-2">
        {summary.repGained > 0 && (
          <Chip icon={Trophy} tint="text-gold-400">+{summary.repGained} reputation</Chip>
        )}
        {streak > 0 && <Chip icon={Flame} tint="text-blood-400">{streak}-fight streak</Chip>}
        {summary.cardsEarned > 0 && (
          <Chip icon={Layers} tint="text-volt-400">{summary.cardsEarned} card{summary.cardsEarned === 1 ? "" : "s"} earned</Chip>
        )}
      </div>

      {summary.cardsEarned > 0 && (
        <Link href="/collection" className="mt-4 inline-block rounded-lg bg-blood-500 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-blood-600">
          View your new cards
        </Link>
      )}
    </section>
  );
}

function Chip({ icon: Icon, tint, children }: { icon: typeof Trophy; tint: string; children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-ink-700 bg-ink-950/50 px-3 py-1.5 text-xs font-semibold text-chalk">
      <Icon className={`size-3.5 ${tint}`} /> {children}
    </span>
  );
}
