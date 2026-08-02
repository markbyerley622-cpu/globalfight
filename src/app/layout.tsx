import type { Metadata, Viewport } from "next";
import { Oswald } from "next/font/google";
import localFont from "next/font/local";
import "./globals.css";
import { Footer } from "@/components/layout/footer";
import { DemoWorldBanner } from "@/components/layout/demo-world-banner";
import { Ticker } from "@/components/layout/ticker";
import { AppShell } from "@/components/layout/app-shell";
import { I18nProvider } from "@/lib/i18n";
import { AuthProvider } from "@/lib/auth-client";
import { getCurrentUser } from "@/lib/auth";
import { ChunkReloadGuard } from "@/components/chunk-reload-guard";
import { ServiceWorkerRegistrar } from "@/components/pwa/service-worker";
import { InstallPrompt } from "@/components/pwa/install-prompt";
import { isDemoMode } from "@/lib/demo-world";
import { SITE, isCanonicalHost } from "@/lib/config";

// Mona Sans (owner-supplied variable font) is the primary UI/body typeface.
// Mapped onto the existing --font-inter variable so every surface picks it up
// without touching the Tailwind theme. Oswald stays for condensed display headings.
const inter = localFont({
  src: "../../public/fonts/MonaSans-Variable.woff2",
  variable: "--font-inter",
  display: "swap",
  weight: "200 900",
});
const oswald = Oswald({
  subsets: ["latin"], weight: ["400", "500", "600", "700"],
  variable: "--font-oswald", display: "swap",
});

export const viewport: Viewport = {
  themeColor: "#05070a",
  width: "device-width",
  initialScale: 1,
  // The reels feed runs edge-to-edge and the app is installable, so the layout
  // must extend under the notch/home indicator; `env(safe-area-inset-*)` only
  // resolves to non-zero once viewport-fit is cover.
  viewportFit: "cover",
};

// Shown when someone drops a link in WhatsApp/X/Slack/iMessage. This is the
// whole pitch in the two lines a preview card actually renders, so it stays
// concrete ("upcoming", "what people think") rather than describing a schema.
const OG_TITLE = `${SITE.name} — every combat sport, one place`;
const OG_DESCRIPTION =
  "Upcoming fights, results and fighter records across boxing, MMA, Muay Thai, " +
  "kickboxing, BJJ and bare-knuckle — and what the fans think of them. " +
  "See what's on next.";
const OG_IMAGE = {
  url: "/og-default.png",
  width: 1200,
  height: 630,
  alt: `${SITE.name} — every combat sport, one place. See what's upcoming, see what people think.`,
};

export const metadata: Metadata = {
  metadataBase: new URL(SITE.url),
  title: { default: `${SITE.name} — ${SITE.tagline}`, template: `%s · ${SITE.name}` },
  description: SITE.description,
  applicationName: SITE.name,
  // The iOS home-screen label. "Combat" was a truncation of the OLD name and
  // is the string that sits under the icon forever after an install.
  appleWebApp: { capable: true, title: SITE.name, statusBarStyle: "black-translucent" },
  keywords: [
    "boxing", "rankings", "pound for pound", "fight predictions",
    "champions", "combat sports", "fight schedule", "boxing news", "P4P",
  ],
  openGraph: {
    type: "website",
    siteName: SITE.name,
    title: OG_TITLE,
    description: OG_DESCRIPTION,
    url: SITE.url,
    locale: "en_US",
    images: [OG_IMAGE],
  },
  twitter: {
    card: "summary_large_image",
    title: OG_TITLE,
    description: OG_DESCRIPTION,
    // NO `images` here, deliberately.
    //
    // A root-level twitter.images is INHERITED by every page, and the
    // opengraph-image.tsx convention does not override it — so every share on X
    // carried the generic og-default.png while og:image (WhatsApp, iMessage,
    // Facebook, Slack) carried the real card. Six OG routes — profiles, events,
    // fighters, fights, victory cards, scorecards — were all rendering the default
    // image on X, which is the platform a share card exists for.
    //
    // Omitting it lets each page's opengraph-image populate twitter:image too, and
    // pages without one still preview correctly: X falls back to og:image when
    // twitter:image is absent, and openGraph.images above supplies that.
  },
  // Indexable ONLY on the deployment whose origin an operator named explicitly.
  // A Render service slug is reachable whether or not it is the address we
  // publish, and indexing it splits every ranking signal across two hosts and
  // keeps the temporary one alive in results after it stops being served. See
  // isCanonicalHost — robots.ts refuses the crawl, this refuses the index.
  robots: isCanonicalHost()
    ? { index: true, follow: true }
    : { index: false, follow: false, nocache: true },
  alternates: { canonical: "/" },
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  // Resolve the session ONCE on the server (cache-deduped) and hand it to the
  // client AuthProvider, so the first paint already knows the user — no
  // /api/auth/me round-trip on load and no loading→resolved flash (the profile
  // CLS root cause). This reads cookies(), so the tree renders dynamically —
  // an accepted trade-off (the header is personalized on every page anyway).
  const initialUser = await getCurrentUser();
  return (
    <html lang="en" className={`${inter.variable} ${oswald.variable}`} suppressHydrationWarning>
      <body className="min-h-dvh bg-ink-950 antialiased">
        <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-[200] focus:rounded focus:bg-blood-500 focus:px-4 focus:py-2 focus:text-white">
          Skip to content
        </a>
        <ChunkReloadGuard />
        <ServiceWorkerRegistrar />
        <DemoWorldBanner />
        <I18nProvider>
          <AuthProvider initialUser={initialUser}>
            <AppShell ticker={<Ticker />} footer={<Footer demoMode={isDemoMode()} />}>
              {children}
            </AppShell>
            <InstallPrompt />
          </AuthProvider>
        </I18nProvider>
      </body>
    </html>
  );
}
