import { cn } from "@/lib/utils";
import type { Athlete } from "@/lib/domain/types";

const SIZES = {
  sm: "h-9 w-9 text-xs",
  md: "h-12 w-12 text-sm",
  lg: "h-16 w-16 text-base",
} as const;

/**
 * Compact participant imagery with a graceful initials placeholder — no fighter
 * photography ships in the skeleton, so every avatar is a deterministic
 * fallback keyed to the athlete's initials.
 */
export function FighterAvatar({
  athlete,
  size = "md",
  corner,
  className,
}: {
  athlete: Athlete;
  size?: keyof typeof SIZES;
  corner?: "red" | "blue";
  className?: string;
}) {
  const initials = athlete.name
    .split(" ")
    .map((part) => part[0])
    .slice(0, 2)
    .join("");
  const ring =
    corner === "red"
      ? "ring-2 ring-[var(--color-red-corner)]"
      : corner === "blue"
        ? "ring-2 ring-[var(--color-blue-corner)]"
        : "";
  return (
    <span
      className={cn(
        "grid shrink-0 place-items-center rounded-full bg-surface-2 font-semibold text-muted",
        SIZES[size],
        ring,
        className,
      )}
      aria-hidden
    >
      {initials}
    </span>
  );
}
