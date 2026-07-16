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
    optimizePackageImports: ["lucide-react", "motion"],
  },
};

export default nextConfig;
