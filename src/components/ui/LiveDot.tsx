import { cn } from "@/lib/utils";

/** Pulsing ring indicator for live states (Combat Register `.live-dot`). */
export function LiveDot({ className }: { className?: string }) {
  return <span className={cn("live-dot", className)} aria-hidden />;
}
