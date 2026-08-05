import { cn } from "@/lib/utils";
import { ButtonLink } from "@/components/ui/button";

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
        "rounded-card border border-dashed border-ink-700 bg-ink-900/40 text-center",
        compact ? "px-4 py-8" : "px-6 py-12",
        className,
      )}
    >
      <span
        aria-hidden
        className="mx-auto grid size-12 place-items-center rounded-lg border border-ink-700 bg-ink-850"
        style={accent ? { borderColor: `${accent}44`, background: `${accent}14`, color: accent } : undefined}
      >
        {icon}
      </span>

      <p className="mt-3 font-display text-base font-bold uppercase tracking-wide text-chalk">{title}</p>
      {body && <p className="mx-auto mt-1.5 max-w-sm text-sm leading-relaxed text-fog">{body}</p>}

      {action && (
        <ButtonLink href={action.href} size="sm" className="mt-4 px-4">
          {action.label}
        </ButtonLink>
      )}

      {secondary && <div className="mt-3 flex flex-wrap items-center justify-center gap-2">{secondary}</div>}
    </div>
  );
}
