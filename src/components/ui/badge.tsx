import { cn } from "@/lib/utils";
import type { RankMovement } from "@/lib/types";
import { ArrowUp, ArrowDown, Minus } from "lucide-react";

export function Badge({
  children, className, tone = "neutral",
}: {
  children: React.ReactNode;
  className?: string;
  tone?: "neutral" | "red" | "gold" | "live" | "volt";
}) {
  const tones = {
    neutral: "bg-ink-700/60 text-mist border-ink-600",
    red: "bg-blood-500/15 text-blood-300 border-blood-500/30",
    gold: "bg-gold-500/15 text-gold-300 border-gold-500/30",
    live: "bg-blood-500/20 text-blood-300 border-blood-500/40",
    volt: "bg-volt-500/15 text-volt-400 border-volt-500/30",
  } as const;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-md border px-2 py-0.5 text-[0.68rem] font-semibold uppercase tracking-wider",
        tones[tone], className,
      )}
    >
      {children}
    </span>
  );
}

export function MovementIndicator({ movement, delta }: { movement: RankMovement; delta?: number }) {
  if (movement === "UP")
    return <span className="inline-flex items-center gap-0.5 text-up text-xs font-bold"><ArrowUp className="size-3" />{delta ?? ""}</span>;
  if (movement === "DOWN")
    return <span className="inline-flex items-center gap-0.5 text-down text-xs font-bold"><ArrowDown className="size-3" />{delta ?? ""}</span>;
  // "NEW" renders as the same neutral dash as "SAME". It used to be a gold
  // ✨NEW pill, and the reason that was wrong is mechanical: movementFor()
  // returns "NEW" whenever previousRank is null, which is EVERY row on a list's
  // first ingest. So a freshly-ingested division showed fifteen "NEW" badges —
  // the badge marked "we have no history yet", not "this fighter just broke in",
  // and it read as unfinished placeholder UI on exactly the screens a first-time
  // visitor lands on. The movement is still stored; it is simply not decorated.
  return <span className="text-fog"><Minus className="size-3" /></span>;
}
