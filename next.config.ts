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
  async redirects() {
    return [{ source: "/predictions/:slug", destination: "/fights/:slug", permanent: true }];
  },
  // Global security headers. The hard ones (frame/nosniff/referrer/HSTS) are
  // enforced immediately — they are safe and non-breaking. CSP ships as
  // Report-Only FIRST: a strict enforced CSP on Next needs per-request nonces
  // (a middleware change) and can white-screen the app, so we observe violation
  // reports against this policy before flipping it to enforced. See HARDENING.md.
  async headers() {
    const csp = [
      "default-src 'self'",
      "base-uri 'self'",
      "object-src 'none'",
      "frame-ancestors 'none'",
      "form-action 'self'",
      // Next injects inline hydration/runtime; 'unsafe-inline' stays until a
      // nonce middleware lands (tracked for Wave 1). Report-Only, so no risk yet.
      "script-src 'self' 'unsafe-inline'",
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: blob: https://*.r2.dev https://*.r2.cloudflarestorage.com https://*.public.blob.vercel-storage.com https://*.basemaps.cartocdn.com",
      "font-src 'self' data:",
      "connect-src 'self'",
      "media-src 'self' https://*.r2.dev blob:",
      "worker-src 'self' blob:",
      "manifest-src 'self'",
      "upgrade-insecure-requests",
    ].join("; ");

    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(self), browsing-topics=()" },
          { key: "Content-Security-Policy-Report-Only", value: csp },
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
  },
};

export default nextConfig;
