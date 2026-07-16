"use client";

import { useEffect, useRef, useState } from "react";
import { BACKGROUNDS } from "@/lib/backgrounds";

// App-wide ambient backdrop: a smooth two-layer crossfade through the combat
// photography in /public/backgrounds (run `npm run gen:backgrounds` after adding
// files). Frames advance as you scroll the app shell, with a gentle idle
// auto-advance. Only the current + incoming image are ever loaded, so it stays
// light on mobile.
const SCROLL_STEP = 600; // px of scroll per frame change
const IDLE_MS = 4000; // pause auto-advance while actively scrolling
const AUTO_MS = 8000; // ambient advance interval when idle

function shuffle<T>(arr: T[]): T[] {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

export function RotatingBackdrop() {
  const [frames, setFrames] = useState<string[]>(BACKGROUNDS);
  const [index, setIndex] = useState(0);
  // Two stacked layers that crossfade; only one changes at a time.
  const [ab, setAb] = useState<{ a: string; b: string; showA: boolean }>({
    a: BACKGROUNDS[0] ?? "",
    b: "",
    showA: true,
  });
  const lastScroll = useRef(0);

  // Shuffle after mount (client-only, avoids SSR hydration mismatch) for variety.
  useEffect(() => {
    if (BACKGROUNDS.length > 1) setFrames(shuffle([...BACKGROUNDS]));
  }, []);

  // Crossfade whenever the current index changes.
  useEffect(() => {
    const n = Math.max(frames.length, 1);
    const src = frames[index % n];
    if (!src) return;
    setAb((p) => {
      if (p.showA ? p.a === src : p.b === src) return p; // already showing it
      return p.showA ? { a: p.a, b: src, showA: false } : { a: src, b: p.b, showA: true };
    });
  }, [index, frames]);

  // Scroll-sync on the app-shell scroll region.
  useEffect(() => {
    const el = document.getElementById("main");
    if (!el) return;
    const onScroll = () => {
      lastScroll.current = Date.now();
      setIndex(Math.floor(el.scrollTop / SCROLL_STEP) % Math.max(frames.length, 1));
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    onScroll();
    return () => el.removeEventListener("scroll", onScroll);
  }, [frames.length]);

  // Gentle ambient advance when idle (respects reduced-motion).
  useEffect(() => {
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
    const id = setInterval(() => {
      if (Date.now() - lastScroll.current < IDLE_MS) return;
      setIndex((i) => (i + 1) % Math.max(frames.length, 1));
    }, AUTO_MS);
    return () => clearInterval(id);
  }, [frames.length]);

  const layer = (src: string, show: boolean): React.CSSProperties => ({
    backgroundImage: src ? `url("${src}")` : undefined,
    backgroundSize: "cover",
    // Biased to the upper-middle so faces/action stay in frame on portrait phones.
    backgroundPosition: "center 32%",
    opacity: show ? 0.42 : 0,
    filter: "grayscale(0.15) contrast(1.08) brightness(0.95)",
  });

  return (
    <div aria-hidden className="pointer-events-none fixed inset-0 z-0 overflow-hidden">
      <div className="absolute inset-0 transition-opacity duration-[1500ms] ease-out" style={layer(ab.a, ab.showA)} />
      <div className="absolute inset-0 transition-opacity duration-[1500ms] ease-out" style={layer(ab.b, !ab.showA)} />
      {/* Legibility scrims — light enough that the photo reads. */}
      <div className="absolute inset-0 vignette opacity-80" />
      <div className="absolute inset-0 bg-ink-950/30" />
      <div className="absolute inset-0 bg-grid opacity-30" />
    </div>
  );
}
