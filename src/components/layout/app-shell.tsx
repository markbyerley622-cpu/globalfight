"use client";

import { useState, useEffect, useRef } from "react";
import { usePathname, useRouter } from "next/navigation";
import Link from "next/link";
import { Search } from "lucide-react";
import { Logo } from "@/components/logo";
import { AnalyticsPageviews } from "@/components/analytics-pageviews";
import { BottomTabBar } from "./bottom-tab-bar";
import { SectionTabs, activeSection, sectionIndex } from "./section-tabs";
import { SponsorsStrip } from "./sponsors-strip";
import { NavSheet } from "./nav-sheet";
import { AccountMenu } from "./account-menu";
import { RotatingBackdrop } from "./rotating-backdrop";
import { LanguageSwitcher } from "./language-switcher";
import { PillarNav } from "./pillar-nav";
import { OnlineCount } from "./online-count";

/**
 * App-wide shell: a 100dvh flex frame with a fixed top bar (logo · search ·
 * menu burger), the swipeable section tabs, a live-ticker slot, a single inner
 * scroll region, a sponsors strip and a bottom tab bar. Search jumps to the
 * fighters directory; the burger opens the full nav (NavSheet).
 */
export function AppShell({
  ticker,
  footer,
  children,
}: {
  ticker: React.ReactNode;
  footer: React.ReactNode;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const mainRef = useRef<HTMLElement>(null);
  const [navOpen, setNavOpen] = useState(false);

  useEffect(() => { setNavOpen(false); }, [pathname]);

  // Mobile: swipe left/right between the current section's surfaces. Ignores
  // horizontal scrollers ([data-hscroll]) and mostly-vertical swipes.
  //
  // Perf: prefetch every sibling section up front so a swipe (or a tab tap)
  // navigates from the cached RSC payload instead of a cold server round-trip —
  // this is what removes the flip-through lag. Navigation only fires on a
  // *completed* deliberate swipe (touchend), and never when the gesture starts
  // inside a horizontal scroller ([data-hscroll]) such as a filter row.
  useEffect(() => {
    const section = activeSection(pathname);
    if (!section) return;

    // Warm the router cache for instant sibling navigation.
    section.forEach((s) => router.prefetch(s.href));

    const el = mainRef.current;
    if (!el) return;
    const idx = sectionIndex(section, pathname);

    // A swipe that begins inside any horizontally-scrollable element (a filter
    // row, carousel, etc.) must scroll THAT element, never navigate sections.
    // We honour explicit [data-hscroll] markers AND auto-detect real overflow,
    // so a scroller can't hijack you to Community mid-scroll.
    const startsInHScroller = (target: HTMLElement | null): boolean => {
      for (let n: HTMLElement | null = target; n && n !== el; n = n.parentElement) {
        if (n.hasAttribute("data-hscroll")) return true;
        const ox = getComputedStyle(n).overflowX;
        if ((ox === "auto" || ox === "scroll") && n.scrollWidth > n.clientWidth + 4) return true;
      }
      return false;
    };

    let x0 = 0, y0 = 0, skip = false;
    const onStart = (e: TouchEvent) => {
      const t = e.touches[0];
      x0 = t.clientX; y0 = t.clientY;
      skip = startsInHScroller(e.target as HTMLElement);
    };
    const onEnd = (e: TouchEvent) => {
      if (skip || idx < 0) return;
      const t = e.changedTouches[0];
      const dx = t.clientX - x0, dy = t.clientY - y0;
      // Require a decisive, horizontally-dominant swipe.
      if (Math.abs(dx) < 64 || Math.abs(dx) < Math.abs(dy) * 1.6) return;
      const next = dx < 0 ? idx + 1 : idx - 1;
      if (next >= 0 && next < section.length) router.push(section[next].href);
    };
    el.addEventListener("touchstart", onStart, { passive: true });
    el.addEventListener("touchend", onEnd, { passive: true });
    return () => {
      el.removeEventListener("touchstart", onStart);
      el.removeEventListener("touchend", onEnd);
    };
  }, [pathname, router]);

  const inSection = activeSection(pathname) !== null;

  return (
    <div className="relative flex h-[100dvh] w-full overflow-hidden bg-ink-950">
      {/* App-wide rotating photo backdrop — sits above the base ink, below the UI. */}
      <RotatingBackdrop />
      <AnalyticsPageviews />
      <a href="#main" className="skip-link">Skip to content</a>
      <div className="relative z-10 flex min-w-0 flex-1 flex-col">
        {/* Top bar — logo + actions row, with the Breaking ticker docked
            directly beneath inside the same header block. */}
        <header className="z-40 shrink-0 border-b border-ink-800 bg-ink-950/90 backdrop-blur-xl">
          <div className="flex items-center gap-3 px-4 pb-2 pt-[calc(0.5rem+env(safe-area-inset-top))]">
            <Logo sizeClass="h-9 lg:h-10" showWordmark={false} />
            {/* Desktop pillars — the bottom bar is lg:hidden, so without this
                Location was only reachable from the burger on a laptop. */}
            <PillarNav className="ml-3 hidden lg:flex" />
            <div className="ml-auto flex items-center gap-2">
              <OnlineCount />
              <Link
                href="/fighters"
                aria-label="Search fighters"
                className="flex size-9 items-center justify-center rounded-xl border border-ink-700 bg-ink-800 text-mist transition-colors hover:text-chalk"
              >
                <Search className="size-[1.05rem]" />
              </Link>
              <AccountMenu onOpenNav={() => setNavOpen(true)} />
              {/* Language lives at the very top-right of the header. */}
              <LanguageSwitcher />
            </div>
          </div>
          {/* Breaking ticker — inside the header, between the top bar and tabs. */}
          <div className="border-t border-ink-800/60">{ticker}</div>
        </header>

        {/* Section tabs — swipeable on mobile. */}
        {inSection && (
          <div className="z-30 shrink-0 border-b border-ink-800 bg-ink-950/90 backdrop-blur-xl">
            <SectionTabs />
          </div>
        )}

        {/* Single scroll region — pages drop in unchanged */}
        <main ref={mainRef} id="main" className="hide-scrollbar min-h-0 flex-1 overflow-y-auto overflow-x-hidden">
          {children}
          <div className="hidden lg:block">{footer}</div>
        </main>

        <SponsorsStrip />
        <BottomTabBar className="lg:hidden" />
      </div>

      <NavSheet open={navOpen} onClose={() => setNavOpen(false)} />
    </div>
  );
}
