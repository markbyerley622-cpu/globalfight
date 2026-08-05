import { cn } from "@/lib/utils";
import type { RankMovement } from "@/lib/types";
import { ArrowUp, ArrowDown, Minus } from "lucide-react";

export type BadgeTone = "neutral" | "red" | "gold" | "live" | "volt" | "hot" | "outline";
export type BadgeSize = "sm" | "md";

const TONES: Record<BadgeTone, string> = {
  neutral: "bg-ink-700/60 text-mist border-ink-600",
  red: "bg-blood-500/15 text-blood-300 border-blood-500/30",
  gold: "bg-gold-500/15 text-gold-300 border-gold-500/30",
  live: "bg-blood-500/20 text-blood-300 border-blood-500/40",
  volt: "bg-volt-500/15 text-volt-400 border-volt-500/30",
  //  `hot` layers the sheen keyframe over the red tone. `.hot-sheen` sets
  //  overflow:hidden and an inset ::after, so it composes with the border.
  hot: "bg-blood-500/15 text-blood-300 border-blood-500/30 hot-sheen",
  //  The only tone that is border-first: no fill, so it recedes behind the
  //  filled tones sitting next to it in a card header row.
  outline: "bg-transparent text-fog border-ink-600",
};

//  Size varies type and rhythm, not the box: both steps keep px-2 py-0.5 so a
//  mixed row of sm and md badges still shares one baseline.
const SIZES: Record<BadgeSize, string> = {
  sm: "gap-1 text-4xs font-bold tracking-wide",
  md: "gap-1.5 text-2xs font-semibold tracking-wider",
};

export function Badge({
  children, className, tone = "neutral", size = "md",
}: {
  children: React.ReactNode;
  className?: string;
  tone?: BadgeTone;
  size?: BadgeSize;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-md border px-2 py-0.5 uppercase",
        SIZES[size], TONES[tone], className,
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
