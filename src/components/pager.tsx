"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { useT } from "@/lib/i18n";
import { cn } from "@/lib/utils";

/** URL-driven prev/next pager. The server page reads `?page` and renders 10/page. */
export function Pager({ page, hasNext }: { page: number; hasNext: boolean }) {
  const pathname = usePathname();
  const params = useSearchParams();
  const t = useT();

  // `page` is the 0-based INTERNAL index; `?page` in the URL is 1-based (the
  // server does `Number(?page) - 1`). `href` therefore takes a 1-based target —
  // getting this wrong is an off-by-one where "Next" maps straight back to the
  // page you're already on.
  const current = page + 1; // 1-based, matches the URL
  const href = (target1: number) => {
    const q = new URLSearchParams(params.toString());
    if (target1 <= 1) q.delete("page");
    else q.set("page", String(target1));
    const s = q.toString();
    return s ? `${pathname}?${s}` : pathname;
  };

  if (page === 0 && !hasNext) return null;

  const btn = "flex items-center gap-1 rounded-lg border px-3.5 py-2 font-display text-xs font-semibold uppercase tracking-wide transition-colors";
  const enabled = "border-ink-700 bg-ink-850/60 text-mist hover:border-ink-600 hover:text-chalk";
  const disabled = "border-ink-800 text-ink-600 pointer-events-none";

  return (
    <div className="mt-6 flex items-center justify-center gap-3">
      {page > 0
        ? <Link href={href(current - 1)} className={cn(btn, enabled)}><ChevronLeft className="size-4" /> {t("Previous")}</Link>
        : <span className={cn(btn, disabled)}><ChevronLeft className="size-4" /> {t("Previous")}</span>}
      <span className="text-sm text-fog">{t("Page")} {current}</span>
      {hasNext
        ? <Link href={href(current + 1)} className={cn(btn, enabled)}>{t("Next")} <ChevronRight className="size-4" /></Link>
        : <span className={cn(btn, disabled)}>{t("Next")} <ChevronRight className="size-4" /></span>}
    </div>
  );
}
