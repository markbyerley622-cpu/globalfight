/* Combat Register service worker — deliberately conservative.
 *
 *  • API and dynamic data are NEVER cached (always live).
 *  • Navigations are network-first, falling back to cache, then an offline page.
 *  • Only hashed static assets (/_next/static, icons, images, fonts) are cached.
 *  • A new deploy takes over immediately (skipWaiting + one controlled reload),
 *    so users are never stuck on a stale shell.
 *
 *  Kill switch: to disable, deploy a /sw.js whose fetch handler is empty and that
 *  calls self.registration.unregister() on activate — the next visit clears it.
 */
const VERSION = "cr-v1";
const STATIC_CACHE = `${VERSION}-static`;
const PRECACHE = ["/offline", "/icons/icon-192.png", "/icons/icon-512.png"];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(STATIC_CACHE).then((c) => c.addAll(PRECACHE)).catch(() => {}));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(keys.filter((k) => !k.startsWith(VERSION)).map((k) => caches.delete(k)));
      await self.clients.claim();
    })(),
  );
});

self.addEventListener("message", (event) => {
  if (event.data && event.data.type === "SKIP_WAITING") self.skipWaiting();
});

const STATIC_RE = /\.(?:png|jpg|jpeg|svg|webp|gif|ico|woff2?)$/;

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // leave cross-origin alone
  if (url.pathname.startsWith("/api")) return; // never cache API / dynamic data

  // Navigations: network-first → cache → offline page.
  if (req.mode === "navigate") {
    event.respondWith(
      (async () => {
        try {
          return await fetch(req);
        } catch {
          return (await caches.match(req)) || (await caches.match("/offline")) || Response.error();
        }
      })(),
    );
    return;
  }

  // Immutable static assets: cache-first, populate on miss.
  if (url.pathname.startsWith("/_next/static") || url.pathname.startsWith("/icons") || STATIC_RE.test(url.pathname)) {
    event.respondWith(
      (async () => {
        const cached = await caches.match(req);
        if (cached) return cached;
        try {
          const res = await fetch(req);
          if (res.ok) {
            const cache = await caches.open(STATIC_CACHE);
            cache.put(req, res.clone());
          }
          return res;
        } catch {
          return cached || Response.error();
        }
      })(),
    );
  }
  // Everything else falls through to the network (no caching of dynamic HTML/data).
});
