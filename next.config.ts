import path from "path";
import { fileURLToPath } from "url";

import type { NextConfig } from "next";

const projectRoot = path.dirname(fileURLToPath(import.meta.url));

const nextConfig: NextConfig = {
  // A stray lockfile above this directory can make Next infer the wrong
  // workspace root, so file tracing is pinned to the project itself.
  outputFileTracingRoot: projectRoot,
};

export default nextConfig;
