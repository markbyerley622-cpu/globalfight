import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { HomeLandingPage } from "@/components/home-landing";
import { META } from "@/components/home-landing/content";

/**
 * `/` serves two different things, decided on the server from the session cookie
 * before any HTML is sent.
 *
 *   • signed out → the public landing page
 *   • signed in  → /events, exactly as before
 *
 * The redirect is not a leftover; it is the point. `/` has redirected to /events
 * since the events app became the home, and for a member — or an installed PWA,
 * which opens the bare origin — the app IS the destination. Handing them a
 * marketing page they have already converted from would be a regression dressed
 * as a feature. So the landing page is shown to exactly the people it is written
 * for, and nobody waits a frame to find out which they are.
 *
 * A signed-in visitor therefore never renders the landing page, which is also
 * why there is no signed-in variant of it: a CTA reading "Open your profile" for
 * a reader who can never reach it would be code only a test could execute.
 *
 * `getCurrentUser()` is request-deduped with React `cache()`, so asking here and
 * in the layout costs one lookup, not two.
 */

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  // `absolute`, because the layout's "%s · Combat Reviews" template would
  // otherwise append the product name to a title that already ends in it.
  title: { absolute: META.title },
  description: META.description,
  alternates: { canonical: "/" },
  openGraph: {
    type: "website",
    title: META.title,
    description: META.description,
    url: "/",
    // The site's own share card: our wordmark and our artwork. No fighter
    // photography — nothing here is licensed for redistribution as an OG image.
    images: [{ url: "/og-default.png", width: 1200, height: 630, alt: META.title }],
  },
  twitter: {
    card: "summary_large_image",
    title: META.title,
    description: META.description,
    images: ["/og-default.png"],
  },
};

export default async function HomePage({
  searchParams,
}: {
  searchParams: Promise<{ sport?: string }>;
}) {
  const user = await getCurrentUser();

  if (user) {
    // A sport filter on the URL is carried through exactly as before, so an
    // existing `/?sport=boxing` link still lands a member on the filtered app.
    const { sport } = await searchParams;
    redirect(sport ? `/events?sport=${encodeURIComponent(sport)}` : "/events");
  }

  return <HomeLandingPage />;
}
