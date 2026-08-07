"use client";

import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { CTA, ROUTES } from "./content";
import { trackLanding } from "./analytics";

/**
 * The conversion controls.
 *
 * Both are real `<Link>`s to the real account route — no dialog, no duplicate
 * form, no email capture that goes somewhere other than sign-up. A visitor who
 * middle-clicks, right-click-copies or opens in a new tab gets the account page,
 * because that is what the href says. The click handler only measures; it never
 * decides where the reader goes, so an analytics failure cannot break the one
 * action this page exists for.
 *
 * `position` names WHERE on the page the CTA was pressed (hero, story, final).
 * Without it every conversion collapses into one number and the page cannot be
 * improved: "the final CTA converts, the hero CTA does not" is the finding that
 * changes a design.
 */

export function PrimaryCta({
  position,
  label = CTA.primary,
  size = "lg",
  className,
}: {
  position: string;
  label?: string;
  size?: "md" | "lg";
  className?: string;
}) {
  return (
    <Link
      href={ROUTES.signup}
      data-testid="home-primary-cta"
      onClick={() => {
        trackLanding("home_primary_cta_clicked", position);
        // The step the funnel is actually measured on: the reader has left the
        // marketing page for the form. Completion is the account route's own
        // `signup` event — see the note in lib/analytics.ts.
        trackLanding("home_signup_started", position);
      }}
      className={cn("hl-btn hl-btn-primary", size === "lg" && "hl-btn-lg", className)}
    >
      {label}
      <ArrowRight className="size-4" aria-hidden="true" />
    </Link>
  );
}

export function SecondaryCta({
  position,
  label = CTA.secondary,
  href = ROUTES.events,
  size = "lg",
  className,
}: {
  position: string;
  label?: string;
  href?: string;
  size?: "md" | "lg";
  className?: string;
}) {
  return (
    <Link
      href={href}
      data-testid="home-secondary-cta"
      onClick={() => trackLanding("home_secondary_cta_clicked", position)}
      className={cn("hl-btn hl-btn-ghost", size === "lg" && "hl-btn-lg", className)}
    >
      {label}
    </Link>
  );
}

/**
 * A product-preview link. Same measurement contract as the CTAs: the id is a
 * literal window id from content.ts, never anything derived from the data the
 * window happens to be showing.
 */
export function PreviewLink({
  id,
  href,
  children,
  className,
}: {
  id: string;
  href: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <Link
      href={href}
      onClick={() => trackLanding("home_product_preview_clicked", id)}
      className={cn("hl-window-link", className)}
    >
      {children}
      <ArrowRight className="size-3.5" aria-hidden="true" />
    </Link>
  );
}
