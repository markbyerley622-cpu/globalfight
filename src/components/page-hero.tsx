"use client";

import { useRouter } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { useT } from "@/lib/i18n";
import { useCanGoBack } from "@/lib/navigation-history";

/**
 * The standard page header: eyebrow ("where am I"), title, description, actions.
 *
 * It also renders the Back control, and that is deliberate rather than a per-page
 * decision. "Every detail page should expose an obvious Return action, with
 * consistent placement and consistent styling" is not something a dozen pages can
 * each remember to do — /news/[slug], /rankings/[slug], /community/[slug] and the
 * rest each had their own header and none had a way back, so on mobile (where the
 * bottom bar only jumps between top-level pillars) those pages were dead ends.
 * Putting it here makes the affordance structural: a page gets it by using the
 * shared header, and it appears in the same place at the same size on all of them.
 *
 * It renders ONLY when there is in-app history to return to (`useCanGoBack`), so a
 * top-level pillar the user opened directly does not grow a Back button that would
 * eject them from the site. Pages that want an explicit destination for cold
 * entries pass `backFallback`.
 */
export function PageHero({
  eyebrow, title, description, children, backFallback, hideBack,
}: {
  eyebrow: string;
  title: string;
  description?: string;
  children?: React.ReactNode;
  /** Where Back goes when the user arrived cold (shared link, new tab). */
  backFallback?: string;
  /** Opt out — for a true top-level surface where Back is meaningless. */
  hideBack?: boolean;
}) {
  const t = useT();
  const router = useRouter();
  const canGoBack = useCanGoBack();
  const showBack = !hideBack && (canGoBack || !!backFallback);

  return (
    <section className="relative overflow-hidden border-b border-ink-800">
      <div className="absolute inset-0 bg-grid opacity-50" />
      <div className="absolute -left-32 top-0 size-96 rounded-full bg-blood-700/15 blur-[110px]" />
      <div className="absolute inset-0 vignette" />
      <div className="container-cr relative py-12 lg:py-16">
        {showBack && (
          <button
            type="button"
            onClick={() => {
              // Real history-back is the only path that restores the previous
              // page's scroll position — see layout/scroll-restoration.tsx.
              if (canGoBack) router.back();
              else if (backFallback) router.push(backFallback);
            }}
            // `flex w-fit`, NOT `inline-flex`. The eyebrow immediately below is
            // `.eyebrow`, which is itself inline-flex — so two inline-level
            // siblings shared a line box and "Every card that matters" wrapped
            // up beside the Back button instead of starting underneath it. A
            // block-level button ends the line; `w-fit` keeps it hugging its
            // label rather than stretching the full container width.
            // PageHero renders on every top-level page, so this was the same
            // collision everywhere, not just on /events.
            className="mb-4 flex w-fit items-center gap-1.5 rounded-lg border border-ink-700 bg-ink-850/70 px-3 py-1.5 text-xs font-semibold text-mist backdrop-blur transition-colors hover:border-ink-600 hover:text-chalk active:scale-[0.98]"
          >
            <ArrowLeft className="size-4" />
            {t("Back")}
          </button>
        )}
        <span className="eyebrow">{t(eyebrow)}</span>
        <h1 className="mt-2 font-display text-4xl font-bold uppercase tracking-tight text-chalk sm:text-5xl lg:text-6xl">
          {t(title)}
        </h1>
        {description && <p className="mt-3 max-w-2xl text-sm text-mist sm:text-base">{t(description)}</p>}
        {children && <div className="mt-6">{children}</div>}
      </div>
    </section>
  );
}
