"use client";

import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { useT } from "@/lib/i18n";

export function SectionHeading({
  eyebrow, title, href, hrefLabel = "View all",
}: {
  eyebrow: string;
  title: string;
  href?: string;
  hrefLabel?: string;
}) {
  const t = useT();
  return (
    <div className="mb-6 flex items-end justify-between gap-4">
      <div>
        <span className="eyebrow">{t(eyebrow)}</span>
        <h2 className="mt-1.5 font-display text-2xl font-bold uppercase tracking-tight text-chalk sm:text-3xl">
          {t(title)}
        </h2>
      </div>
      {href && (
        <Link
          href={href}
          className="group flex shrink-0 items-center gap-1 font-display text-xs font-semibold uppercase tracking-wide text-mist transition-colors hover:text-blood-400"
        >
          {t(hrefLabel)}
          <ArrowRight className="size-3.5 transition-transform group-hover:translate-x-0.5" />
        </Link>
      )}
    </div>
  );
}
