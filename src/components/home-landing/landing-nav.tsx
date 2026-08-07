"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Logo } from "@/components/logo";
import { NAV, CTA, ROUTES } from "./content";
import { trackLanding } from "./analytics";

/**
 * The landing page's own top bar.
 *
 * It replaces the app chrome on `/` rather than sitting under it. The product
 * header carries search, notifications, messages, an account menu and five
 * pillars — every one of which is the wrong thing to put in front of somebody
 * who has not yet decided whether this product is for them, and two of which
 * (the bell, the DM button) are signed-in-only and so render as nothing here
 * anyway. A marketing page gets a marketing nav: where you are, four places you
 * can look, and the one action the page is asking for.
 *
 * Transparent over the hero, opaque once the reader has moved. The scroll it
 * listens to is the app shell's inner `<main>` — the document itself never
 * scrolls in this shell, which is why a `window` scroll listener would sit
 * silent forever. `passive: true` keeps it off the scrolling critical path, and
 * the state is a boolean rather than a scroll offset so React re-renders twice
 * in a session, not sixty times a second.
 */

function scrollParentOf(el: HTMLElement | null): HTMLElement | Window {
  for (let n = el?.parentElement ?? null; n; n = n.parentElement) {
    const overflowY = getComputedStyle(n).overflowY;
    if ((overflowY === "auto" || overflowY === "scroll") && n.scrollHeight > n.clientHeight + 4) {
      return n;
    }
  }
  return window;
}

export function LandingNav() {
  const ref = useRef<HTMLElement>(null);
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const scroller = scrollParentOf(ref.current);
    const read = () =>
      setScrolled((scroller instanceof Window ? window.scrollY : scroller.scrollTop) > 24);
    read();
    scroller.addEventListener("scroll", read, { passive: true });
    return () => scroller.removeEventListener("scroll", read);
  }, []);

  return (
    <header ref={ref} className="hl-nav" data-scrolled={scrolled ? "true" : "false"}>
      <div className="hl-nav-inner">
        <Logo sizeClass="h-9 lg:h-10" showWordmark={false} href="/" />

        {/* Hidden below `lg`, where the four links would either wrap or shrink
            below a 44px target. The same destinations are one tap away inside
            the product, which the Explore CTA opens. */}
        <nav aria-label="Sections" className="hl-nav-links">
          {NAV.map((item) => (
            <Link key={item.href} href={item.href} className="hl-nav-link">
              {item.label}
            </Link>
          ))}
        </nav>

        <div className="hl-nav-actions">
          <Link
            href={ROUTES.signin}
            className="hl-nav-signin"
            onClick={() => trackLanding("home_secondary_cta_clicked", "nav-signin")}
          >
            {CTA.signin}
          </Link>
          {/* Visible at every width, including the smallest phone — the brief's
              one non-negotiable on mobile, and the reason the nav links give way
              first rather than this. */}
          <Link
            href={ROUTES.signup}
            className="hl-nav-cta"
            onClick={() => {
              trackLanding("home_primary_cta_clicked", "nav");
              trackLanding("home_signup_started", "nav");
            }}
          >
            {CTA.primaryShort}
          </Link>
        </div>
      </div>
    </header>
  );
}
