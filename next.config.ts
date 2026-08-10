import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  images: {
    formats: ["image/avif", "image/webp"],
    // Allow-list only — images must come from our OWN storage (uploads route
    // through the image pipeline in src/lib/images/store.ts → R2 / Vercel Blob).
    // No wide-open "**": we don't proxy/optimize arbitrary third-party hosts.
    // Anything outside this list falls back to a placeholder rather than
    // re-hosting an unlicensed source. (External market thumbnails render via
    // next/image `unoptimized`, which bypasses this list.)
    remotePatterns: [
      { protocol: "https", hostname: "**.r2.dev" },
      { protocol: "https", hostname: "**.r2.cloudflarestorage.com" },
      { protocol: "https", hostname: "**.public.blob.vercel-storage.com" },
    ],
  },
  // Legacy per-bout URL → the matchup page. Handled here rather than by a
  // Server Component calling redirect(): a dynamic page has already begun
  // streaming by the time it redirects, so Next falls back to a 200 + meta
  // refresh — a weak signal that leaves the old URL indexable. This is a real
  // 308 issued before any React renders.
  //
  // `mine` is EXCLUDED: /predictions/mine is not a bout, it is the signed-in
  // user's own prediction record (src/app/predictions/mine/page.tsx). Without
  // the exclusion this rule 308'd it to /fights/mine, which /fights/[slug]
  // resolves to notFound() — so every "My Predictions" entry point in the app
  // (profile, profile stats, account menu, home rail) landed on a soft-404 and
  // the page itself was unreachable code.
  async redirects() {
    return [
      { source: "/predictions/:slug((?!mine$)[^/]+)", destination: "/fights/:slug", permanent: true },
      // Settings moved to the top level. It is account administration, not a
      // subsection of a public profile, and nesting it under /profile is part of
      // how it stayed invisible: nothing in the top-level navigation pointed at
      // it, and the account menu's "Settings" item pointed at /account — the
      // SIGN-UP page — instead.
      //
      // A real 308 here rather than a redirect() inside the page, for the reason
      // the rule above documents: a dynamic page has already begun streaming by
      // the time it redirects, so Next falls back to a 200 + meta refresh. This
      // path is linked from /terms and /community-guidelines and is in people's
      // bookmarks, so it has to be a redirect a crawler and a browser both honour.
      { source: "/profile/settings", destination: "/settings", permanent: true },
    ];
  },
  // Global security headers.
  //
  // The CSP is NOT here any more. It needs a per-request nonce to be enforced
  // without 'unsafe-inline', and a static header cannot carry one — it lives in
  // src/middleware.ts, which is also the only place that can hand the same
  // nonce to Next so the framework stamps its own script tags with it.
  //
  // These five stay static because they are constant, and because they must
  // apply to responses the middleware matcher deliberately skips (hashed
  // assets, API routes) as well as to HTML.
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          // Redundant with the CSP's `frame-ancestors 'none'` on HTML routes,
          // and kept for the assets middleware does not run on, plus browsers
          // that never implemented frame-ancestors.
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(self), browsing-topics=()" },
        ],
      },
    ];
  },
  // `sharp` is a native Node addon (via detect-libc → child_process). Declaring it
  // external stops webpack bundling it into the Node server compile.
  serverExternalPackages: ["sharp"],
  // instrumentation.ts is compiled for the Edge runtime too (Next default). Its
  // dynamic sharp import is dead code off the Node runtime (guarded by
  // NEXT_RUNTIME !== "nodejs"), but webpack still descends into sharp on the edge
  // target and chokes on `node:child_process`, 500-ing every route in dev. Mark
  // sharp external on non-Node compiles so webpack never resolves its internals.
  webpack: (config, { nextRuntime }) => {
    if (nextRuntime !== "nodejs") {
      const existing = Array.isArray(config.externals)
        ? config.externals
        : config.externals
          ? [config.externals]
          : [];
      // Externalize the Node-only image lib and any `node:` builtin it pulls in
      // (node:fs, node:path, …) so the edge compile of instrumentation's dead
      // code path never tries to bundle them.
      const externalizeNodeOnly = (
        data: { request?: string },
        callback: (err?: null, result?: string) => void,
      ): void => {
        const request = data.request;
        if (request === "sharp" || (request && request.startsWith("node:"))) {
          callback(null, `commonjs ${request}`);
          return;
        }
        callback();
      };
      config.externals = [...existing, externalizeNodeOnly];
    }
    return config;
  },
  experimental: {
    optimizePackageImports: ["lucide-react"],
    // ── Build memory ──────────────────────────────────────────────────────
    // The Render deploy started dying with "Ineffective mark-compacts near
    // heap limit" at ~2 GB during "Creating an optimized production build".
    //
    // The same build passes locally under an identical `--max-old-space-size=2048`
    // cap, which rules out a simple "needs a bigger heap" story: the difference
    // is CPU COUNT. Next splits compilation across workers sized to the
    // available cores, so a many-core dev machine spreads the same work over
    // several processes with independent heaps, while a 2-core builder does far
    // more of it inside one. Peak memory per process is what changed, not total
    // work.
    //
    // This flag makes webpack release intermediate module/chunk graphs as it
    // goes instead of holding them for the whole compile. It costs a little
    // build TIME and is the supported answer for exactly this failure.
    webpackMemoryOptimizations: true,
  },
};

export default nextConfig;
