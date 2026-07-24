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
// Bump on any change that must purge old caches (activate deletes non-VERSION
// caches), so no one is left on a stale shell after a deploy.
const VERSION = "cr-v2";
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

        const res = await fetch(req);

        // The cache write MUST be kept alive by the event, and the clone must
        // be drained by someone. Firing `cache.put(req, res.clone())` without
        // awaiting it and without waitUntil let the worker be killed with the
        // clone's body still buffered — which back-pressures and errors the
        // ORIGINAL response the page is reading. Measured: 5–7 chunks per cold
        // visit dying with ERR_FAILED under the worker and zero without it,
        // which is a half-hydrated app for whoever loses the race.
        if (res.ok) {
          event.waitUntil(caches.open(STATIC_CACHE).then((c) => c.put(req, res.clone())).catch(() => {}));
        }
        return res;
      })(),
    );
  }
  // Everything else falls through to the network (no caching of dynamic HTML/data).
});

// ── Web Push ───────────────────────────────────────────────────────────────
// The server sends a JSON payload written by src/lib/push/send.ts. Everything
// here is defensive: a push that throws inside the worker is swallowed by the
// browser and the user simply never sees the notification, so every field has
// a fallback and the whole handler is wrapped.
self.addEventListener("push", (event) => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch { data = {}; }

  const title = data.title || "Combat Reviews";
  const url = data.url || "/";

  event.waitUntil(
    self.registration.showNotification(title, {
      body: data.body || undefined,
      icon: "/icon.png",
      badge: "/icon.png",
      // `tag` collapses replacements: an event going live should update the
      // existing card, not stack a tenth one on the lock screen.
      tag: data.tag || undefined,
      renotify: !!data.tag,
      // The click target has to survive into notificationclick — the event
      // there carries only the notification, not the original payload.
      data: { url },
    }),
  );
});

// Focus an existing tab rather than opening a duplicate: a user who already has
// the app open should be taken to the content, not given a second window.
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = (event.notification.data && event.notification.data.url) || "/";

  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((list) => {
      for (const c of list) {
        if ("focus" in c) { c.navigate(target); return c.focus(); }
      }
      return self.clients.openWindow(target);
    }),
  );
});
