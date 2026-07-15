import { cn } from "@/lib/utils";

type BadgeTone = "neutral" | "brand" | "live" | "success" | "warning" | "outline" | "volt";

const TONES: Record<BadgeTone, string> = {
  neutral: "bg-ink-700/60 text-mist border-ink-600",
  brand: "bg-blood-500/15 text-blood-300 border-blood-500/30",
  live: "bg-blood-500/20 text-blood-300 border-blood-500/40",
  success: "bg-up/15 text-up border-up/30",
  warning: "bg-gold-500/15 text-gold-300 border-gold-500/30",
  volt: "bg-volt-500/15 text-volt-400 border-volt-500/30",
  outline: "border-ink-600 text-mist",
};

/**
 * Bordered, uppercase micro-label in the Combat Register house style.
 */
export function Badge({
  tone = "neutral",
  className,
  children,
}: {
  tone?: BadgeTone;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-md border px-2 py-0.5 text-[0.68rem] font-semibold uppercase tracking-wider leading-none",
        TONES[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}
