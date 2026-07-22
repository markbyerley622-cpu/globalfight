"use client";

import Image from "next/image";
import { track } from "@/lib/analytics-client";
import { sponsorHref, type Sponsor } from "@/lib/sponsors";
import { cn } from "@/lib/utils";

// ════════════════════════════════════════════════════════════════════════════
//  One sponsor mark, rendered the same way everywhere.
//
//  This exists because both sponsor surfaces were rendering partner logos with
//  `next/link` and NO target and NO rel — so an external partner URL navigated
//  away from the app in the same tab, and the destination got a live
//  `window.opener` handle back into our page (reverse tabnabbing). Fixing that
//  in two places invites a third place that forgets.
//
//  It also decides link-vs-not: a partner with no confirmed destination renders
//  as a plain image. A logo that looks clickable and goes nowhere is worse than
//  a logo that doesn't look clickable.
// ════════════════════════════════════════════════════════════════════════════

export function SponsorMark({
  sponsor, className, imgClassName, width = 200, height = 80, surface,
}: {
  sponsor: Sponsor;
  className?: string;
  imgClassName?: string;
  width?: number;
  height?: number;
  /** Where the mark was shown, for click attribution. */
  surface: string;
}) {
  const href = sponsorHref(sponsor);

  const img = (
    <Image
      src={sponsor.logo}
      alt={sponsor.name}
      width={width}
      height={height}
      className={cn("w-auto object-contain", imgClassName)}
      style={sponsor.logoScale ? { transform: `scale(${sponsor.logoScale})` } : undefined}
    />
  );

  // No destination → not a link, and not focusable. Announced as an image with
  // the partner's name, which is all it is.
  if (!href) {
    return <span className={cn("flex shrink-0 items-center", className)}>{img}</span>;
  }

  const external = /^https?:\/\//i.test(href);

  return (
    <a
      href={href}
      // `noopener` is the security-relevant one (it severs window.opener);
      // `noreferrer` also covers older browsers that ignore noopener.
      {...(external ? { target: "_blank", rel: "noopener noreferrer sponsored" } : {})}
      aria-label={external ? `${sponsor.name} (opens in a new tab)` : sponsor.name}
      onClick={() => track("sponsor_click", { id: sponsor.id, surface })}
      className={cn(
        "flex shrink-0 items-center rounded-md opacity-90 transition-opacity hover:opacity-100",
        className,
      )}
    >
      {img}
    </a>
  );
}
