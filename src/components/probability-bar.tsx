import { cn } from "@/lib/utils";

export function ProbabilityBar({
  redLabel, blueLabel, redProbability, className, compact = false,
}: {
  redLabel: string;
  blueLabel: string;
  redProbability: number; // 0..1
  className?: string;
  compact?: boolean;
}) {
  const redPct = Math.round(redProbability * 100);
  const bluePct = 100 - redPct;
  const redLead = redPct >= bluePct;
  return (
    <div className={cn("w-full", className)}>
      {!compact && (
        <div className="mb-1.5 flex items-center justify-between text-xs font-semibold uppercase tracking-wide">
          <span className={cn("truncate", redLead ? "text-blood-300" : "text-mist")}>{redLabel}</span>
          <span className={cn("truncate text-right", !redLead ? "text-volt-400" : "text-mist")}>{blueLabel}</span>
        </div>
      )}
      <div className="flex h-7 overflow-hidden rounded-md ring-1 ring-ink-600">
        <div
          className="flex items-center justify-start bg-gradient-to-r from-blood-600 to-blood-500 pl-2 text-xs font-bold text-white transition-all"
          style={{ width: `${redPct}%` }}
        >
          {redPct >= 12 && `${redPct}%`}
        </div>
        <div
          className="flex items-center justify-end bg-gradient-to-l from-volt-500 to-volt-400 pr-2 text-xs font-bold text-ink-950 transition-all"
          style={{ width: `${bluePct}%` }}
        >
          {bluePct >= 12 && `${bluePct}%`}
        </div>
      </div>
    </div>
  );
}
