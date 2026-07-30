"use client";

import { useRouter } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { useT } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { useCanGoBack } from "@/lib/navigation-history";

/**
 * Back control for leaf pages (event / fighter / prediction detail) that sit OUTSIDE
 * the section tabs, where the bottom bar only jumps between sections and a mobile
 * user would otherwise be stuck.
 *
 * It prefers real history-back — that is the ONLY path that restores the previous
 * page's scroll position (see layout/scroll-restoration.tsx) — and falls back to a
 * sane in-app destination only when there is genuinely nothing to go back to.
 *
 * The old test for "is there in-app history" was:
 *
 *     window.history.length > 1 && document.referrer.startsWith(origin)
 *
 * `document.referrer` describes the DOCUMENT, and in an App Router SPA the document
 * is only loaded once. Client-side navigation never updates it. So for anyone who
 * arrived by typing the URL, from a bookmark, or through the installed PWA — all of
 * which leave `document.referrer` empty — the condition was false forever, no matter
 * how many pages deep they had browsed. Every Back press ran `router.push(fallback)`
 * instead: a fresh forward navigation, to a page they hadn't come from, landing at
 * the top. That is precisely the reported "Back to Leaderboard sends me to the top".
 *
 * `useCanGoBack` tracks in-app navigations in this document instead, which is the
 * thing actually being asked about.
 */
export function BackButton({
  fallback = "/events",
  label,
  className,
}: {
  fallback?: string;
  label?: string;
  className?: string;
}) {
  const router = useRouter();
  const canGoBack = useCanGoBack();
  const t = useT();
  const text = label ?? t("Back");

  return (
    <button
      type="button"
      onClick={() => {
        // router.back() triggers popstate, which is what lets scroll-restoration
        // recognise the navigation and put the user back where they were.
        if (canGoBack) router.back();
        else router.push(fallback);
      }}
      aria-label={text}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-lg border border-ink-700 bg-ink-850/70 px-3 py-1.5 text-xs font-semibold text-mist backdrop-blur transition-colors hover:border-ink-600 hover:text-chalk active:scale-[0.98]",
        className,
      )}
    >
      <ArrowLeft className="size-4" />
      {text}
    </button>
  );
}
