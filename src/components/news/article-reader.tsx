"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import Image from "next/image";
import { ExternalLink, Loader2, X } from "lucide-react";
import { ShareMenu } from "@/components/share-menu";
import { safeNewsCover } from "@/lib/media-safe";
import { cn } from "@/lib/utils";

// ════════════════════════════════════════════════════════════════════════════
//  Read an article without leaving GlobalFight.
//
//  Tapping a story used to be target="_blank": the reader left, and whatever they
//  were scrolling through was gone. This keeps them here — the feed is still
//  mounted behind the modal, so closing it returns to the exact scroll position
//  with no restoration logic at all. Not unmounting the page IS the scroll
//  restoration.
//
//  ── WHY THE IFRAME IS NOT THE DEFAULT ─────────────────────────────────────
//  Most publishers refuse framing. The browser cannot tell us that (a blocked
//  frame is silent and cross-origin), so embeddability is checked SERVER-side
//  first — see lib/embeddability — and the iframe only mounts on a yes. The
//  alternative, "render the iframe and hope", shows a blank white rectangle,
//  which is worse than an honest preview.
//
//  Portalled to document.body for the same reason the Sheet is: an ancestor with
//  backdrop-filter becomes the containing block for `position: fixed`, and the app
//  header has one.
// ════════════════════════════════════════════════════════════════════════════

export interface ReaderArticle {
  id: string;
  title: string;
  excerpt?: string;
  category?: string;
  coverImageUrl?: string;
  sourceUrl: string;
  author?: string;
  publishedAt?: string;
  /** Internal path, for the share menu — we share OUR page, not the publisher's. */
  sharePath?: string;
}

type State =
  | { phase: "checking" }
  | { phase: "framed" }
  | { phase: "fallback"; reason: string };

const publisherOf = (url: string): string => {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "the publisher";
  }
};

export function ArticleReader({
  article,
  onClose,
}: {
  article: ReaderArticle;
  onClose: () => void;
}) {
  const [state, setState] = useState<State>({ phase: "checking" });
  const [frameLoaded, setFrameLoaded] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);

  const publisher = publisherOf(article.sourceUrl);

  // ── embeddability, before anything is framed ──────────────────────────────
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const res = await fetch(`/api/embeddable?url=${encodeURIComponent(article.sourceUrl)}`);
        const data = (await res.json()) as { embeddable: boolean; reason?: string };
        if (!alive) return;
        setState(data.embeddable ? { phase: "framed" } : { phase: "fallback", reason: data.reason ?? "blocked" });
      } catch {
        // The check failing is not the publisher's fault, but the outcome is the
        // same for the reader: show something real rather than an empty frame.
        if (alive) setState({ phase: "fallback", reason: "check failed" });
      }
    })();
    return () => { alive = false; };
  }, [article.sourceUrl]);

  // ── focus trap + escape, and background scroll lock ───────────────────────
  useEffect(() => {
    const previouslyFocused = document.activeElement as HTMLElement | null;
    closeRef.current?.focus();

    const { overflow } = document.body.style;
    document.body.style.overflow = "hidden";

    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") { onClose(); return; }
      if (e.key !== "Tab") return;
      const panel = panelRef.current;
      if (!panel) return;
      // Only OUR controls are focusable; the iframe's contents are cross-origin and
      // the browser handles focus inside it. Tab cycles the header controls.
      const els = Array.from(
        panel.querySelectorAll<HTMLElement>('a[href],button:not([disabled]),iframe,[tabindex]:not([tabindex="-1"])'),
      ).filter((el) => el.offsetParent !== null);
      if (!els.length) return;
      const first = els[0];
      const last = els[els.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    };

    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = overflow;
      previouslyFocused?.focus?.();
    };
  }, [onClose]);

  const stop = useCallback((e: React.MouseEvent) => e.stopPropagation(), []);

  if (typeof document === "undefined") return null;

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label={article.title}
      onClick={onClose}
      className="fixed inset-0 z-[130] flex items-end justify-center bg-ink-950/80 backdrop-blur-sm sm:items-center sm:p-6"
    >
      <div
        ref={panelRef}
        onClick={stop}
        className={cn(
          "flex w-full flex-col overflow-hidden border border-ink-700 bg-ink-900",
          // Mobile: a full-height sheet with safe-area padding. Desktop: a centred
          // card at ~90vw/90vh, which is the size the brief asked for.
          "h-[92dvh] rounded-t-3xl pb-[env(safe-area-inset-bottom)]",
          "sm:h-[90vh] sm:max-w-5xl sm:rounded-2xl sm:pb-0",
        )}
      >
        {/* ── header ──────────────────────────────────────────────────────── */}
        <div className="flex shrink-0 items-center gap-2 border-b border-ink-800 px-3 py-2.5">
          <button
            ref={closeRef}
            type="button"
            onClick={onClose}
            aria-label="Close reader"
            className="tap grid size-9 shrink-0 place-items-center rounded-lg border border-ink-700 text-mist transition-colors hover:text-chalk focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blood-400"
          >
            <X className="size-4" />
          </button>

          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold text-chalk">{article.title}</p>
            <p className="truncate text-[0.68rem] text-fog">
              {publisher}
              {article.author ? ` · ${article.author}` : ""}
            </p>
          </div>

          {article.sharePath && (
            <ShareMenu path={article.sharePath} title={article.title} compact label="Share article" />
          )}
          {/* Always available, whatever the frame does. A reader who wants the real
              page must never have to close the modal to find the link. */}
          <a
            href={article.sourceUrl}
            target="_blank"
            rel="noopener noreferrer"
            aria-label={`Open on ${publisher} in a new tab`}
            className="tap grid size-9 shrink-0 place-items-center rounded-lg border border-ink-700 text-mist transition-colors hover:text-chalk focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blood-400"
          >
            <ExternalLink className="size-4" />
          </a>
        </div>

        {/* ── body ────────────────────────────────────────────────────────── */}
        <div className="relative min-h-0 flex-1 bg-ink-950">
          {state.phase === "checking" && (
            <div className="flex h-full items-center justify-center gap-2 text-sm text-mist" role="status">
              <Loader2 className="size-4 animate-spin" /> Opening…
            </div>
          )}

          {state.phase === "framed" && (
            <>
              {!frameLoaded && (
                <div className="absolute inset-0 flex items-center justify-center gap-2 text-sm text-mist" role="status">
                  <Loader2 className="size-4 animate-spin" /> Loading {publisher}…
                </div>
              )}
              <iframe
                src={article.sourceUrl}
                title={article.title}
                onLoad={() => setFrameLoaded(true)}
                // SANDBOXED. The publisher's page runs with scripts (it needs them
                // to render) but WITHOUT same-origin access to us, without the
                // ability to navigate the top-level window away from GlobalFight,
                // and without popups. allow-same-origin is deliberately absent:
                // combined with allow-scripts it would let the frame remove its own
                // sandbox.
                sandbox="allow-scripts allow-forms allow-popups-to-escape-sandbox"
                referrerPolicy="no-referrer-when-downgrade"
                loading="lazy"
                className={cn("size-full border-0 bg-white transition-opacity", frameLoaded ? "opacity-100" : "opacity-0")}
              />
            </>
          )}

          {state.phase === "fallback" && (
            // NOT a browser error. The publisher declined to be framed, which is
            // their right, so this is a designed preview that still gives the
            // reader the story's shape and one obvious way to finish it.
            <div className="h-full overflow-y-auto">
              <div className="relative aspect-video w-full bg-ink-850">
                <Image
                  src={safeNewsCover(article.id, article.coverImageUrl)}
                  alt=""
                  fill
                  unoptimized
                  className="object-cover"
                />
                <span className="pointer-events-none absolute inset-0 bg-gradient-to-t from-ink-950 via-ink-950/30 to-transparent" />
              </div>
              <div className="mx-auto max-w-2xl px-5 pb-10 pt-6">
                {article.category && (
                  <p className="text-[0.65rem] font-bold uppercase tracking-[0.2em] text-blood-400">{article.category}</p>
                )}
                <h2 className="mt-2 font-display text-2xl font-bold leading-tight text-chalk md:text-3xl">
                  {article.title}
                </h2>
                <p className="mt-2 text-xs text-fog">
                  {publisher}
                  {article.author ? ` · ${article.author}` : ""}
                </p>
                {article.excerpt && (
                  <p className="mt-4 text-[0.95rem] leading-relaxed text-mist">{article.excerpt}</p>
                )}
                <a
                  href={article.sourceUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="tap mt-6 inline-flex items-center gap-2 rounded-xl bg-blood-500 px-5 py-3 font-display text-sm font-bold uppercase tracking-wide text-white transition-colors hover:bg-blood-400 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blood-400"
                >
                  Read on {publisher} <ExternalLink className="size-4" />
                </a>
                <p className="mt-3 text-[0.7rem] text-fog">
                  {publisher} doesn&apos;t allow their pages to be embedded, so this one opens in a new tab.
                </p>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}
