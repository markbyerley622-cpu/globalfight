"use client";

import { useRouter } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { useT } from "@/lib/i18n";
import { cn } from "@/lib/utils";

/**
 * Back control for leaf pages (event / fighter detail) that sit OUTSIDE the
 * section tabs, where the bottom bar only jumps between sections and mobile
 * users would otherwise be stuck. Prefers real history-back; on a cold entry
 * (shared link, new tab — nothing to go back to) it falls to a sane in-app
 * destination instead of leaving the app.
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
  const t = useT();
  const text = label ?? t("Back");

  return (
    <button
      type="button"
      onClick={() => {
        if (typeof window !== "undefined" && window.history.length > 1) router.back();
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
