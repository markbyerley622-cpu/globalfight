"use client";

import Image from "next/image";
import Link from "next/link";
import { BadgeCheck } from "lucide-react";
import { cn } from "@/lib/utils";

// ════════════════════════════════════════════════════════════════════════════
//  The pieces every preview card is built from.
//
//  Shared so the five cards are the same OBJECT seen from five angles rather
//  than five designs that drifted. A kind that needs a part nobody else has
//  writes it inline; a part that a second kind then wants moves here.
// ════════════════════════════════════════════════════════════════════════════

/** Compact counts. A 320px card has no room for "12,431". */
export function compact(n: number): string {
  if (n < 1000) return String(n);
  if (n < 10_000) return `${(n / 1000).toFixed(1).replace(/\.0$/, "")}k`;
  if (n < 1_000_000) return `${Math.round(n / 1000)}k`;
  return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, "")}m`;
}

/** The identity row: mark, name, subtitle, optional verification. */
export function PreviewHeader({
  imageUrl, name, subtitle, verified, round, fallback, badge,
}: {
  imageUrl?: string | null;
  name: string;
  subtitle?: string | null;
  verified?: boolean;
  /** People are round; places and events are not. */
  round?: boolean;
  /** Drawn when there is no image — a crest, a logo, an initial. */
  fallback?: React.ReactNode;
  /** Sits under the mark, e.g. a presence dot. */
  badge?: React.ReactNode;
}) {
  return (
    <div className="flex items-start gap-2.5">
      <span className="relative shrink-0">
        <span
          className={cn(
            "grid size-11 place-items-center overflow-hidden border border-ink-700 bg-ink-900",
            round ? "rounded-full" : "rounded-lg",
          )}
        >
          {imageUrl ? (
            <Image src={imageUrl} alt="" width={44} height={44} className="size-full object-cover" unoptimized />
          ) : (
            fallback ?? (
              <span className="font-display text-sm font-black text-fog">
                {name.slice(0, 1).toUpperCase()}
              </span>
            )
          )}
        </span>
        {badge && <span className="absolute -bottom-0.5 -right-0.5">{badge}</span>}
      </span>

      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-1">
          <span className="truncate font-display text-sm font-black leading-tight text-chalk">{name}</span>
          {verified && <BadgeCheck className="size-3.5 shrink-0 text-volt-400" aria-label="Verified" />}
        </span>
        {subtitle && <span className="mt-0.5 block truncate text-2xs text-fog">{subtitle}</span>}
      </span>
    </div>
  );
}

/** A row of counts. Empty cells are dropped rather than shown as zero. */
export function PreviewStats({
  stats,
}: {
  stats: { label: string; value: number | null }[];
}) {
  const shown = stats.filter((s) => s.value !== null);
  if (shown.length === 0) return null;
  return (
    <div className="mt-2.5 flex flex-wrap items-center gap-x-3 gap-y-1">
      {shown.map((s) => (
        <span key={s.label} className="flex items-baseline gap-1">
          <span className="font-display text-xs font-black tabular-nums text-chalk">
            {compact(s.value as number)}
          </span>
          <span className="text-3xs uppercase tracking-wider text-fog">{s.label}</span>
        </span>
      ))}
    </div>
  );
}

/** A labelled fact line. */
export function PreviewFact({
  icon: Icon, children,
}: {
  icon: React.ComponentType<{ className?: string }>;
  children: React.ReactNode;
}) {
  return (
    <p className="mt-1.5 flex items-start gap-1.5 text-2xs leading-relaxed text-mist">
      <Icon className="mt-px size-3 shrink-0 text-fog" aria-hidden />
      <span className="min-w-0 flex-1">{children}</span>
    </p>
  );
}

/**
 * The action row at the foot of a card.
 *
 * The FIRST action carries `data-card-focus`, which is what the chip's
 * ArrowDown handler moves focus to — so a keyboard reader lands on something
 * useful rather than on the card's container.
 */
export function PreviewActions({ children }: { children: React.ReactNode }) {
  return <div className="mt-3 flex flex-wrap items-center gap-1.5">{children}</div>;
}

const ACTION_BASE =
  "tap inline-flex min-h-8 items-center gap-1 rounded-lg px-2.5 font-display text-3xs font-bold " +
  "uppercase tracking-wider transition-colors focus-visible:outline focus-visible:outline-2 " +
  "focus-visible:outline-offset-2 focus-visible:outline-blood-400";

export function PreviewAction({
  href, external, primary, focusTarget, children,
}: {
  href: string;
  external?: boolean;
  primary?: boolean;
  /** Exactly one action per card sets this — see PreviewActions. */
  focusTarget?: boolean;
  children: React.ReactNode;
}) {
  const className = cn(
    ACTION_BASE,
    primary
      ? "bg-blood-500 text-white hover:bg-blood-400"
      : "border border-ink-600 bg-ink-800 text-chalk hover:border-ink-500",
  );
  const focusAttr = focusTarget ? { "data-card-focus": "" } : {};

  if (external) {
    return (
      <a href={href} target="_blank" rel="noopener noreferrer" className={className} {...focusAttr}>
        {children}
      </a>
    );
  }
  return (
    <Link href={href} className={className} {...focusAttr}>
      {children}
    </Link>
  );
}
