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
