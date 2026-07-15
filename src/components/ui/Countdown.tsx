"use client";

import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import { countdown } from "@/lib/domain/format";

/**
 * Live-ticking countdown to an event/bout start. Renders nothing meaningful
 * until mounted to avoid server/client time mismatch.
 */
export function Countdown({
  target,
  className,
  compact = false,
}: {
  target: string;
  className?: string;
  compact?: boolean;
}) {
  const [now, setNow] = useState<Date | null>(null);

  useEffect(() => {
    setNow(new Date());
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);

  if (!now) {
    return <span className={cn("tabular-nums text-muted", className)} suppressHydrationWarning>—</span>;
  }

  const c = countdown(target, now);
  if (c.past) {
    return <span className={cn("tabular-nums text-live", className)}>Underway</span>;
  }

  if (compact) {
    const label = c.days > 0 ? `${c.days}d ${c.hours}h` : c.hours > 0 ? `${c.hours}h ${c.minutes}m` : `${c.minutes}m ${c.seconds}s`;
    return <span className={cn("tabular-nums", className)}>{label}</span>;
  }

  const unit = (value: number, label: string) => (
    <span className="flex flex-col items-center">
      <span className="text-base font-semibold tabular-nums leading-none">{String(value).padStart(2, "0")}</span>
      <span className="mt-1 text-[10px] uppercase tracking-wide text-faint">{label}</span>
    </span>
  );

  return (
    <div className={cn("flex items-center gap-3", className)} aria-label="Time until start">
      {c.days > 0 && unit(c.days, "days")}
      {unit(c.hours, "hrs")}
      {unit(c.minutes, "min")}
      {unit(c.seconds, "sec")}
    </div>
  );
}
