import Link from "next/link";
import { cn } from "@/lib/utils";

// ════════════════════════════════════════════════════════════════════════════
//  EmptyState — one shape for "there is nothing here".
//
//  The map, the leaderboard, Following, the gym directory and the gym page all
//  grew their own: different padding, different border (dashed vs solid),
//  different icon treatment, different CTA weight. Empty is the FIRST state
//  most users see on a young product, so five different empties is five
//  different first impressions.
//
//  The `accent` prop tints the icon well to the surface's own colour (red for
//  events, blue for gyms, gold for people) so the empty state still says which
//  part of the product you are in.
// ════════════════════════════════════════════════════════════════════════════

export function EmptyState({
  icon,
  title,
  body,
  accent,
  action,
  secondary,
  className,
  compact,
}: {
  icon: React.ReactNode;
  title: string;
  body?: React.ReactNode;
  /** Hex colour for the icon well — the layer/section identity. */
  accent?: string;
  action?: { href: string; label: string };
  /** Extra links under the primary action (the "how do I fill this?" row). */
  secondary?: React.ReactNode;
  className?: string;
  compact?: boolean;
}) {
  return (
    <div
      className={cn(
        "rounded-2xl border border-dashed border-ink-700 bg-ink-900/40 text-center",
        compact ? "px-4 py-8" : "px-6 py-12",
        className,
      )}
    >
      <span
        aria-hidden
        className="mx-auto grid size-12 place-items-center rounded-2xl border border-ink-700 bg-ink-850"
        style={accent ? { borderColor: `${accent}44`, background: `${accent}14`, color: accent } : undefined}
      >
        {icon}
      </span>

      <p className="mt-3 font-display text-base font-bold uppercase tracking-wide text-chalk">{title}</p>
      {body && <p className="mx-auto mt-1.5 max-w-sm text-sm leading-relaxed text-fog">{body}</p>}

      {action && (
        <Link
          href={action.href}
          className="tap mt-4 inline-flex items-center gap-1.5 rounded-lg bg-blood-500 px-4 py-2.5 font-display text-xs font-bold uppercase tracking-wide text-white transition-colors hover:bg-blood-400"
        >
          {action.label}
        </Link>
      )}

      {secondary && <div className="mt-3 flex flex-wrap items-center justify-center gap-2">{secondary}</div>}
    </div>
  );
}
