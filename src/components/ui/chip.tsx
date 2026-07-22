import Link from "next/link";
import { cn } from "@/lib/utils";

// ════════════════════════════════════════════════════════════════════════════
//  Chip — the app's one filter/segment pill.
//
//  Nineteen files were hand-rolling `rounded-full border px-… text-…` with
//  slightly different padding, weight and active treatments, so the Events
//  filters, the sport pills, the leaderboard segments and the map layers all
//  looked like they came from four different products. This is that pill,
//  once.
//
//  Two tones, because the app genuinely has two meanings:
//    · `accent` (red) — a LAYER or PRODUCT switch. The loudest control.
//    · `neutral` (chalk) — a refinement WITHIN the current view (time window,
//      sort, sub-tab). Quieter on purpose, so a screen never has two things
//      shouting.
//
//  Renders as <a> when given href, <button> otherwise, so the same chip works
//  for URL-driven filters and local state without a second component.
// ════════════════════════════════════════════════════════════════════════════

export type ChipTone = "accent" | "neutral";
export type ChipSize = "sm" | "md";

const SIZE: Record<ChipSize, string> = {
  sm: "gap-1.5 px-3 py-1.5 text-[0.68rem]",
  md: "gap-1.5 px-3.5 py-2 text-[0.72rem]",
};

const ACTIVE: Record<ChipTone, string> = {
  accent: "border-blood-500 bg-blood-500 text-white shadow-[0_6px_20px_-8px_rgba(225,29,42,0.9)]",
  neutral: "border-chalk bg-chalk text-ink-950",
};

const IDLE = "border-ink-700 bg-ink-850 text-mist hover:border-ink-600 hover:text-chalk";

export function chipClass(active: boolean, tone: ChipTone = "accent", size: ChipSize = "md"): string {
  return cn(
    "tap inline-flex shrink-0 items-center whitespace-nowrap rounded-full border font-display font-bold uppercase tracking-wide transition-colors",
    SIZE[size],
    active ? ACTIVE[tone] : IDLE,
  );
}

interface BaseProps {
  active?: boolean;
  tone?: ChipTone;
  size?: ChipSize;
  /** Trailing count. Dimmed against the active fill so it never competes. */
  count?: number;
  /** Leading colour dot — the map's layer identity. */
  dot?: string;
  className?: string;
  children: React.ReactNode;
}

type ChipProps =
  | (BaseProps & { href: string; onClick?: never; ariaLabel?: string })
  | (BaseProps & { href?: undefined; onClick: () => void; ariaLabel?: string });

export function Chip({
  active = false, tone = "accent", size = "md", count, dot, className, children, ariaLabel, ...rest
}: ChipProps) {
  const body = (
    <>
      {dot && (
        <span
          aria-hidden
          className="size-2 rounded-full"
          style={{ background: active ? "#fff" : dot, boxShadow: active ? "none" : `0 0 8px ${dot}` }}
        />
      )}
      {children}
      {typeof count === "number" && (
        <span className={cn("tabular-nums", active ? "opacity-70" : "text-fog")}>{count}</span>
      )}
    </>
  );

  const cls = cn(chipClass(active, tone, size), className);

  if ("href" in rest && rest.href) {
    return (
      <Link href={rest.href} scroll={false} aria-current={active ? "true" : undefined} aria-label={ariaLabel} className={cls}>
        {body}
      </Link>
    );
  }
  return (
    <button type="button" onClick={rest.onClick} aria-pressed={active} aria-label={ariaLabel} className={cls}>
      {body}
    </button>
  );
}

/** Horizontally scrollable chip row. `data-hscroll` stops the app shell's
 *  swipe-between-sections gesture from hijacking a sideways drag on the row. */
export function ChipRow({ className, children }: { className?: string; children: React.ReactNode }) {
  return (
    <div data-hscroll className={cn("hide-scrollbar flex items-center gap-2 overflow-x-auto pr-4", className)}>
      {children}
    </div>
  );
}
