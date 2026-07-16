"use client";

import { createContext, useContext, useState } from "react";
import { scrollToTop } from "@/lib/scroll";
import { cn } from "@/lib/utils";

export interface EventSection {
  id: string;
  label: string;
  /** Server-rendered content passed down as a node — keeps data on the server. */
  node: React.ReactNode;
  /** Optional count/indicator shown in the tab. */
  badge?: string | number;
}

const NavContext = createContext<(id: string) => void>(() => {});

/** Used by content within a section (e.g. Overview) to jump to another tab. */
export function SectionLink({
  to,
  className,
  children,
}: {
  to: string;
  className?: string;
  children: React.ReactNode;
}) {
  const goto = useContext(NavContext);
  return (
    <button type="button" onClick={() => goto(to)} className={className}>
      {children}
    </button>
  );
}

/**
 * Primary event navigation. Sticky, horizontally-scrollable segmented tabs that
 * keep the user anchored to the SAME event while moving between Overview, Fight
 * card, Coverage, Predictions, Discussion and Results. One section shows at a
 * time so the mobile view stays focused on the fight, not a wall of bouts.
 */
export function EventSectionNavigation({
  sections,
  initialId,
}: {
  sections: EventSection[];
  initialId?: string;
}) {
  const [active, setActive] = useState(initialId ?? sections[0]?.id);
  const activeSection = sections.find((s) => s.id === active) ?? sections[0];

  function goto(id: string) {
    setActive(id);
    scrollToTop();
  }

  return (
    <NavContext.Provider value={goto}>
      <div
        role="tablist"
        aria-label="Event sections"
        // top-0, not top-14: the sticky context is <main>, whose top edge already
        // sits below the fixed header. Offsetting by the header height again left
        // a 56px gap that content scrolled through, above the "sticky" bar.
        className="hide-scrollbar sticky top-0 z-30 flex gap-1 overflow-x-auto border-b border-ink-700/70 bg-ink-950/90 px-3 py-2 backdrop-blur"
      >
        {sections.map((section) => {
          const isActive = section.id === activeSection?.id;
          return (
            <button
              key={section.id}
              role="tab"
              type="button"
              aria-selected={isActive}
              aria-controls={`panel-${section.id}`}
              id={`tab-${section.id}`}
              onClick={() => setActive(section.id)}
              style={{ scrollSnapAlign: "start" }}
              className={cn(
                "flex min-h-9 shrink-0 items-center gap-1.5 rounded-full px-3.5 py-1.5 text-sm font-medium transition-colors",
                isActive ? "bg-chalk text-ink-950" : "text-mist hover:bg-ink-800 hover:text-chalk",
              )}
            >
              {section.label}
              {section.badge != null ? (
                <span
                  className={cn(
                    "rounded-full px-1.5 text-[10px] tabular-nums",
                    isActive ? "bg-ink-950/20 text-ink-900" : "bg-ink-700 text-fog",
                  )}
                >
                  {section.badge}
                </span>
              ) : null}
            </button>
          );
        })}
      </div>

      {activeSection ? (
        <div
          role="tabpanel"
          id={`panel-${activeSection.id}`}
          aria-labelledby={`tab-${activeSection.id}`}
          className="px-4 py-5"
        >
          {activeSection.node}
        </div>
      ) : null}
    </NavContext.Provider>
  );
}
