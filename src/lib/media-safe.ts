// ════════════════════════════════════════════════════════════════════════
//  Media safety gate — the last line before an image reaches a page.
//
//  Two problems this solves:
//
//  1. The 7,635 re-hosted fighter photos are deleted, but the DATABASE still holds
//     `/fighters/<slug>/thumb.webp` URLs pointing at them. Rendering those would
//     produce broken images — and, worse, if anyone ever restored the files it would
//     silently start serving unlicensed photography again. So a path under
//     /fighters/ is refused here, regardless of what the database says.
//
//  2. Publisher cover images used to be HOTLINKED into CSS `background-image`,
//     bypassing next/image's remotePatterns allow-list and leeching the
//     publisher's bandwidth. Now a publisher's RSS syndication image is served
//     through the caching /api/img proxy (attributed + linked to source by the
//     caller); direct remote hosts are still refused unless they are our own
//     storage buckets.
//
//  The rule: an image renders only if we can point at where it came from and why we
//  are allowed to use it. Everything else becomes a locally generated placeholder.
// ════════════════════════════════════════════════════════════════════════

import { personPlaceholder, personHeroPlaceholder, newsPlaceholder } from "@/lib/placeholder";

/** Our own storage. Anything else is somebody else's server. */
const OWN_HOSTS = [/\.r2\.dev$/, /\.r2\.cloudflarestorage\.com$/, /\.public\.blob\.vercel-storage\.com$/];

/**
 * Paths that held unlicensed re-hosted photography, and the sponsor/promoter marks
 * purged as trademarks (see docs/GIT-HISTORY-SANITIZATION.md). Permanently refused.
 *
 * The files are deleted, but DB rows still point at them — FighterSponsor.logoUrl
 * in particular. Without this, a stale row renders a path that 404s to an HTML page
 * and next/image throws "isn't a valid image … received text/html". Refusing here
 * degrades to a placeholder instead, so a stale reference cannot break the page.
 */
const QUARANTINED_PATHS = [
  /^\/fighters\//,
  /^\/backgrounds\//,
  /^\/box-iq[-_]/i,
  /^\/batl[-_.]/i,
  /^\/kong[-_.]/i,
];

/**
 * Is this URL safe to render?
 *
 * A data: URI (our own generated placeholder) is always fine. A local path is fine
 * unless it is quarantined. A remote URL is fine only on our own storage.
 */
export function isSafeImageUrl(url: string | null | undefined): boolean {
  if (!url) return false;
  if (url.startsWith("data:image/svg+xml")) return true;

  if (url.startsWith("/")) {
    return !QUARANTINED_PATHS.some((re) => re.test(url));
  }

  try {
    const { hostname, protocol } = new URL(url);
    if (protocol !== "https:") return false;
    return OWN_HOSTS.some((re) => re.test(hostname));
  } catch {
    return false;
  }
}

/** A fighter's avatar/profile image, or a neutral generated tile. */
export function safeFighterImage(
  name: string,
  url: string | null | undefined,
  variant: "square" | "hero" = "square",
): string {
  if (isSafeImageUrl(url)) return url as string;
  return variant === "hero" ? personHeroPlaceholder(name) : personPlaceholder(name);
}

/**
 * A fighter image, or NULL so a caller can render its own initials fallback.
 * Preferred where the component already has a good non-photo state.
 */
export function safeFighterImageOrNull(url: string | null | undefined): string | null {
  return isSafeImageUrl(url) ? (url as string) : null;
}

/**
 * A news cover image, or locally generated category artwork.
 *
 * Order: our own storage (direct) → a publisher's RSS syndication image, served
 * through the caching /api/img proxy so we neither hotlink their bandwidth nor
 * bypass next/image's host allow-list → generated category art. Callers always
 * pair the image with the source name + a link to the original article, keeping
 * feed media within the syndication grant.
 */
export function safeNewsCover(seed: string, url: string | null | undefined): string {
  if (isSafeImageUrl(url)) return url as string;
  return imageProxyUrl(url) ?? newsPlaceholder(seed);
}

/**
 * Route a third-party https image (publisher syndication cover, or a
 * free-licensed Commons fighter photo) through our caching /api/img proxy, or
 * null if it isn't a safe public https URL. Mirrors the proxy's own SSRF guard
 * (no localhost / private ranges / raw IPs) so an unsafe URL degrades cleanly.
 */
export function imageProxyUrl(url: string | null | undefined): string | null {
  if (!url || url.startsWith("data:") || url.startsWith("/")) return null;
  try {
    const { protocol, hostname } = new URL(url);
    if (protocol !== "https:") return null;
    const h = hostname.toLowerCase();
    if (
      h === "localhost" || h.endsWith(".localhost") || h.endsWith(".local") || h.endsWith(".internal") ||
      /^\d{1,3}(\.\d{1,3}){3}$/.test(h) || h.includes(":")
    ) {
      return null;
    }
    return `/api/img?u=${encodeURIComponent(url)}`;
  } catch {
    return null;
  }
}
