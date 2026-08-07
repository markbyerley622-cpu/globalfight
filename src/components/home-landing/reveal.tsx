"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { trackLanding, type LandingEvent } from "./analytics";

/**
 * Scroll-triggered fade-up, and the page-view / section-seen probes.
 *
 * Three properties matter more than the animation itself:
 *
 *  1. **It cannot hide content.** The server renders `data-revealed="true"`, and
 *     the CSS only dims an element explicitly marked `"false"`. With JavaScript
 *     disabled, broken or still downloading, every section is simply visible —
 *     which is also why the crawler and the reduced-motion reader lose nothing.
 *  2. **No flash.** On mount the element measures itself synchronously, so
 *     anything already on screen is revealed in the same frame rather than
 *     hidden and faded back one frame later.
 *  3. **Reduced motion is handled in CSS**, so there is exactly one place to
 *     check what happens when a reader has asked for stillness.
 *
 * The app shell scrolls an inner `<main>`, not the document. IntersectionObserver
 * still works: its default root is the viewport, and an ancestor's overflow clip
 * is applied to the intersection rectangle.
 */

const useIsomorphicLayoutEffect = typeof window === "undefined" ? useEffect : useLayoutEffect;

export function Reveal({
  children,
  className,
  delay = 0,
  as: Tag = "div",
  ...rest
}: {
  children: React.ReactNode;
  className?: string;
  delay?: number;
  as?: "div" | "section" | "li" | "figure" | "header" | "article";
} & React.HTMLAttributes<HTMLElement>) {
  const ref = useRef<HTMLElement>(null);
  const [revealed, setRevealed] = useState(true);

  useIsomorphicLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;

    const rect = el.getBoundingClientRect();
    if (rect.top < window.innerHeight * 0.92 && rect.bottom > 0) return;

    setRevealed(false);
    const io = new IntersectionObserver(
      ([entry]) => {
        if (!entry.isIntersecting) return;
        setRevealed(true);
        io.disconnect();
      },
      { threshold: 0.1, rootMargin: "0px 0px -6% 0px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  return (
    <Tag
      ref={ref as React.Ref<never>}
      className={cn("hl-reveal", className)}
      data-revealed={revealed ? "true" : "false"}
      style={delay ? ({ "--hl-delay": `${delay}ms` } as React.CSSProperties) : undefined}
      {...rest}
    >
      {children}
    </Tag>
  );
}

/** Emits `home_landing_view` once, on mount. Renders nothing. */
export function LandingView() {
  useEffect(() => {
    trackLanding("home_landing_view");
  }, []);
  return null;
}

/** Fires a named event the first time this wrapper reaches the viewport. */
export function SeenProbe({ event, id }: { event: LandingEvent; id?: string }) {
  const ref = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    const fire = () => trackLanding(event, id);
    const rect = el.getBoundingClientRect();
    if (rect.top < window.innerHeight && rect.bottom > 0) {
      fire();
      return;
    }
    const io = new IntersectionObserver(
      ([entry]) => {
        if (!entry.isIntersecting) return;
        fire();
        io.disconnect();
      },
      { threshold: 0.5 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [event, id]);

  return <span ref={ref} aria-hidden="true" className="hl-probe" />;
}
