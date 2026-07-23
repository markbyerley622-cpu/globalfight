"use client";

import { Children, useState } from "react";
import { ChevronDown } from "lucide-react";

/**
 * The fight card, collapsed. A 12-bout show rendered every bout's full prediction
 * module top-to-bottom, so a reader had to scroll past all twelve to reach the
 * card talk and coverage below. This shows the top bouts (main event + co-main +
 * one) and tucks the rest behind a single "View N more predictions" toggle.
 *
 * The hidden modules are NOT mounted while collapsed (Children slice), so the DOM
 * and scroll height both drop until the reader opts in. State is per-visit.
 */
export function CollapsibleFights({
  children,
  initialVisible = 3,
}: {
  children: React.ReactNode;
  initialVisible?: number;
}) {
  const items = Children.toArray(children);
  const [expanded, setExpanded] = useState(false);
  const hiddenCount = Math.max(0, items.length - initialVisible);
  const shown = expanded || hiddenCount === 0 ? items : items.slice(0, initialVisible);

  return (
    <div className="flex flex-col gap-8">
      {shown}
      {hiddenCount > 0 && (
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          aria-expanded={expanded}
          className="tap mx-auto inline-flex min-h-11 items-center gap-2 rounded-xl border border-ink-700 bg-ink-900/60 px-5 py-2.5 font-display text-xs font-bold uppercase tracking-wide text-mist transition-colors hover:border-blood-500/40 hover:text-blood-300 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blood-400"
        >
          {expanded ? "Show fewer" : `View ${hiddenCount} more prediction${hiddenCount === 1 ? "" : "s"}`}
          <ChevronDown className={`size-4 transition-transform ${expanded ? "rotate-180" : ""}`} />
        </button>
      )}
    </div>
  );
}
