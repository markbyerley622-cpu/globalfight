import type { Metadata, Viewport } from "next";
import { Oswald } from "next/font/google";
import localFont from "next/font/local";
import "./globals.css";
import { Footer } from "@/components/layout/footer";
import { Ticker } from "@/components/layout/ticker";
import { AppShell } from "@/components/layout/app-shell";
import { I18nProvider } from "@/lib/i18n";
import { AuthProvider } from "@/lib/auth-client";
import { ChunkReloadGuard } from "@/components/chunk-reload-guard";
import { SITE } from "@/lib/config";

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
};

export const metadata: Metadata = {
  metadataBase: new URL(SITE.url),
  title: { default: `${SITE.name} — ${SITE.tagline}`, template: `%s · ${SITE.name}` },
  description: SITE.description,
  applicationName: SITE.name,
  keywords: [
    "boxing", "rankings", "pound for pound", "fight predictions",
    "champions", "combat sports", "fight schedule", "boxing news", "P4P",
  ],
  openGraph: {
    type: "website",
    siteName: SITE.name,
    title: `${SITE.name} — ${SITE.tagline}`,
    description: SITE.description,
    url: SITE.url,
    images: [{ url: "/cr-logo.png", width: 512, height: 341, alt: SITE.name }],
  },
  twitter: {
    card: "summary_large_image",
    title: `${SITE.name} — ${SITE.tagline}`,
    description: SITE.description,
    images: ["/cr-logo.png"],
  },
  robots: { index: true, follow: true },
  alternates: { canonical: "/" },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${inter.variable} ${oswald.variable}`} suppressHydrationWarning>
      <body className="min-h-dvh bg-ink-950 antialiased">
        <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-[200] focus:rounded focus:bg-blood-500 focus:px-4 focus:py-2 focus:text-white">
          Skip to content
        </a>
        <ChunkReloadGuard />
        <I18nProvider>
          <AuthProvider>
            <AppShell ticker={<Ticker />} footer={<Footer />}>
              {children}
            </AppShell>
          </AuthProvider>
        </I18nProvider>
      </body>
    </html>
  );
}
