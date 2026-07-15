import type { Metadata, Viewport } from "next";
import { Inter, Oswald } from "next/font/google";
import Link from "next/link";
import "./globals.css";

const inter = Inter({ subsets: ["latin"], variable: "--font-inter", display: "swap" });
const oswald = Oswald({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-oswald",
  display: "swap",
});

export const metadata: Metadata = {
  title: {
    default: "GlobalFight — every fight, one home",
    template: "%s · GlobalFight",
  },
  description:
    "Follow global combat sports the way fans actually watch them — one event at a time. Cards, coverage, predictions and discussion in a single destination.",
};

export const viewport: Viewport = {
  themeColor: "#05070a",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${inter.variable} ${oswald.variable}`}>
      <body className="min-h-dvh">
        <div className="mx-auto flex min-h-dvh w-full max-w-screen-md flex-col border-x border-ink-800/60">
          <header className="sticky top-0 z-40 border-b border-ink-700/70 bg-ink-950/85 backdrop-blur">
            <div className="flex h-14 items-center justify-between px-4">
              <Link href="/" className="flex items-center gap-2">
                <span className="grid h-7 w-7 place-items-center rounded-md bg-blood-500 font-display text-sm font-bold text-white shadow-[0_8px_30px_-12px_rgba(225,29,42,0.8)]">
                  GF
                </span>
                <span className="font-display text-[17px] font-semibold uppercase tracking-wide">
                  Global<span className="text-blood-500">Fight</span>
                </span>
              </Link>
              <span className="font-display text-[10px] uppercase tracking-[0.2em] text-fog">
                Skeleton
              </span>
            </div>
          </header>

          <main className="flex-1 pb-16">{children}</main>

          <footer className="border-t border-ink-700/70 px-4 py-6 text-xs text-fog">
            <span className="font-display uppercase tracking-wider text-mist">GlobalFight</span> ·
            event-centric combat-sports platform · demo data only
          </footer>
        </div>
      </body>
    </html>
  );
}
