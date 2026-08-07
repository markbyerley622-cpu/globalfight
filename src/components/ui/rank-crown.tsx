import { Crown } from "lucide-react";
import { cn } from "@/lib/utils";

// ════════════════════════════════════════════════════════════════════════════
//  Podium crowns — gold / silver / bronze for ranks 1, 2 and 3.
//
//  One definition, because the metals were already being spelled out by hand in
//  every place a podium appeared (see app/p4p/page.tsx). Gold has had tokens
//  since day one; silver and bronze got theirs later, and the two lists had
//  already drifted — p4p crowns #1 and gives #2/#3 a MEDAL, while the divisional
//  list gave #1 a gold number and #2/#3 nothing at all.
//
//  A rank outside 1–3 renders nothing, so callers can drop this in
//  unconditionally rather than repeating the test.
// ════════════════════════════════════════════════════════════════════════════

export type PodiumRank = 1 | 2 | 3;

export const isPodium = (rank: number): rank is PodiumRank => rank === 1 || rank === 2 || rank === 3;

/** The metal for each podium place — text colour, and the label a reader hears. */
export const PODIUM = {
  1: { accent: "text-gold-400", label: "Champion — 1st" },
  2: { accent: "text-silver", label: "2nd" },
  3: { accent: "text-bronze", label: "3rd" },
} as const satisfies Record<PodiumRank, { accent: string; label: string }>;

/**
 * A filled crown in the rank's metal.
 *
 * `fill-current` matters: an outline crown at 14px reads as a smudge, and the
 * whole point is that the metal is identifiable at a glance in a dense list.
 */
export function RankCrown({
  rank,
  className,
  size = "sm",
}: {
  rank: number;
  className?: string;
  /** sm — inline in a list row. md — beside a heading or on a card. */
  size?: "sm" | "md";
}) {
  if (!isPodium(rank)) return null;
  const { accent, label } = PODIUM[rank];
  return (
    <Crown
      role="img"
      aria-label={label}
      className={cn(size === "sm" ? "size-3.5" : "size-5", "shrink-0 fill-current", accent, className)}
    />
  );
}
