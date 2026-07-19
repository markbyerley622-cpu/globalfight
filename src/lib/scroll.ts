/**
 * The app shell is `h-[100dvh] overflow-hidden` and the real scroll container is
 * `<main id="main">` (app-shell.tsx), not the document. `window.scrollTo(...)`
 * therefore does nothing here — it silently no-ops, which reads as "pagination
 * is broken": new rows swap in while the viewport stays put, so on a phone the
 * next page appears to start halfway down.
 */
export function scrollToTop(behavior: ScrollBehavior = "smooth") {
  if (typeof document === "undefined") return;
  document.getElementById("main")?.scrollTo({ top: 0, behavior });
}

/**
 * Smooth-scroll a section into view inside the same `#main` container. Sections
 * carry a `scroll-mt-*` so they clear the sticky section rail — scrollIntoView
 * honours that scroll-margin, so we don't hand-compute the offset. No route
 * change, no remount — just moves the existing scroll position.
 */
export function scrollToSection(id: string, behavior: ScrollBehavior = "smooth") {
  if (typeof document === "undefined") return;
  // Honour reduced-motion: jump instead of gliding for users who ask for less.
  const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  document.getElementById(id)?.scrollIntoView({ behavior: reduce ? "auto" : behavior, block: "start" });
}
