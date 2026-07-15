"use client";

import { useEffect, useRef } from "react";
import Link from "next/link";
import { cn } from "@/lib/utils";
import type { Sport, SportSlug } from "@/lib/domain/types";

/**
 * Global sport navigation. A single horizontally-scrollable, touch-swipeable
 * rail rendered at the top of every sport/event screen. The active sport is
 * derived from the route (`activeSlug`), so selection is preserved across
 * navigation without duplicated pages — each sport is the same page with a
 * different param.
 */
export function SportSwitcher({
  sports,
  activeSlug,
  counts,
}: {
  sports: Sport[];
  activeSlug: SportSlug;
  counts?: Partial<Record<SportSlug, number>>;
}) {
  const railRef = useRef<HTMLDivElement>(null);
  const activeRef = useRef<HTMLAnchorElement>(null);

  // Keep the active sport chip in view when the page loads deep-linked.
  useEffect(() => {
    activeRef.current?.scrollIntoView({ inline: "center", block: "nearest" });
  }, [activeSlug]);

  return (
    <nav aria-label="Sports" className="sticky top-14 z-30 border-b border-border/70 bg-bg/85 backdrop-blur">
      <div
        ref={railRef}
        className="no-scrollbar swipe-x flex gap-2 overflow-x-auto px-4 py-2.5"
      >
        {sports.map((sport) => {
          const active = sport.slug === activeSlug;
          const count = counts?.[sport.slug];
          return (
            <Link
              key={sport.id}
              ref={active ? activeRef : undefined}
              href={`/sports/${sport.slug}`}
              aria-current={active ? "page" : undefined}
              style={{ scrollSnapAlign: "center" }}
              className={cn(
                "flex shrink-0 items-center gap-1.5 rounded-full border px-3.5 py-1.5 text-sm font-medium transition-colors",
                "min-h-9", // comfortable touch target
                active
                  ? "border-brand bg-brand text-brand-fg"
                  : "border-border bg-surface text-muted hover:text-fg",
              )}
            >
              <span aria-hidden>{sport.icon}</span>
              <span>{sport.name}</span>
              {count ? (
                <span
                  className={cn(
                    "rounded-full px-1.5 text-[10px] tabular-nums",
                    active ? "bg-brand-fg/20 text-brand-fg" : "bg-surface-2 text-faint",
                  )}
                >
                  {count}
                </span>
              ) : null}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
