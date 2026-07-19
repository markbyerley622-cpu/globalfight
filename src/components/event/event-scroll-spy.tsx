"use client";

import { useEffect, useState } from "react";
import { scrollToSection } from "@/lib/scroll";
import { cn } from "@/lib/utils";

export interface SpySection {
  id: string;
  label: string;
  /** Optional count/indicator shown beside the label. */
  badge?: string | number;
}

/**
 * Sticky scroll-spy for the single-scroll event page — NAVIGATION ONLY. It never
 * renders or hides section content (the sections are server-rendered siblings
 * below it); it only highlights the section currently in view and smooth-scrolls
 * to one when tapped. Replaces the old tab system (which showed one section at a
 * time and jumped to top). No route change, no remount, minimal state.
 */
export function EventScrollSpy({ sections }: { sections: SpySection[] }) {
  const [active, setActive] = useState(sections[0]?.id);

  // Highlight the section currently under the sticky rail. Observing inside the
  // `#main` scroll container (not the document) is what makes it track here,
  // where the app shell — not the window — owns the scroll.
  useEffect(() => {
    const root = document.getElementById("main");
    const els = sections
      .map((s) => document.getElementById(s.id))
      .filter((el): el is HTMLElement => el !== null);
    if (!els.length) return;

    const io = new IntersectionObserver(
      (entries) => {
        const onscreen = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
        if (onscreen[0]) setActive(onscreen[0].target.id);
      },
      // Trip when a section reaches just under the sticky rail; the tall bottom
      // margin keeps exactly one section "active" at a time.
      { root, rootMargin: "-56px 0px -55% 0px", threshold: 0 },
    );
    els.forEach((el) => io.observe(el));
    return () => io.disconnect();
  }, [sections]);

  // Deep link: /events/slug#predictions lands on that section.
  useEffect(() => {
    const id = window.location.hash.slice(1);
    if (id && sections.some((s) => s.id === id)) {
      requestAnimationFrame(() => scrollToSection(id, "auto"));
    }
  }, [sections]);

  return (
    <nav
      aria-label="Event sections"
      className="hide-scrollbar sticky top-0 z-30 flex gap-1.5 overflow-x-auto border-b border-ink-700/70 bg-ink-950/95 px-3 py-2.5 backdrop-blur sm:gap-2 sm:px-4 sm:py-3"
    >
      {sections.map((section) => {
        const isActive = section.id === active;
        return (
          <button
            key={section.id}
            type="button"
            aria-current={isActive ? "true" : undefined}
            onClick={() => {
              setActive(section.id);
              scrollToSection(section.id);
            }}
            className={cn(
              "flex min-h-11 shrink-0 items-center gap-1.5 rounded-xl px-4 py-2 text-sm font-semibold transition-all sm:min-h-12 sm:px-5 sm:text-base",
              isActive
                ? "bg-chalk text-ink-950 shadow-glow-red"
                : "text-mist hover:bg-ink-800 hover:text-chalk active:scale-95",
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
    </nav>
  );
}
