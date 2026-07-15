"use client";

import { createContext, useContext, useState } from "react";
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
 * card, Coverage, Predictions, Discussion and Results. One section is shown at
 * a time so the mobile view stays focused.
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
    // Bring the tab strip back into view when navigating from within content.
    if (typeof window !== "undefined") window.scrollTo({ top: 0, behavior: "smooth" });
  }

  return (
    <NavContext.Provider value={goto}>
      <div
        role="tablist"
        aria-label="Event sections"
        className="no-scrollbar swipe-x sticky top-14 z-30 flex gap-1 overflow-x-auto border-b border-border/70 bg-bg/90 px-3 py-2 backdrop-blur"
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
                "flex shrink-0 items-center gap-1.5 rounded-full px-3.5 py-1.5 text-sm font-medium transition-colors min-h-9",
                isActive ? "bg-fg text-bg" : "text-muted hover:bg-surface hover:text-fg",
              )}
            >
              {section.label}
              {section.badge != null ? (
                <span
                  className={cn(
                    "rounded-full px-1.5 text-[10px] tabular-nums",
                    isActive ? "bg-bg/20" : "bg-surface-2 text-faint",
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
