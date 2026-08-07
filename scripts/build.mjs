#!/usr/bin/env node
// ════════════════════════════════════════════════════════════════════════════
//  The production build, with a heap ceiling that reaches the BUILD WORKERS.
//
//  ── The failure this fixes ────────────────────────────────────────────────
//  The Render deploy died with:
//
//    Creating an optimized production build ...
//    <--- Last few GCs --->
//    [..] Mark-Compact 2034.8 (2056.5) -> 2029.8 (2063.1) MB
//    FATAL ERROR: Ineffective mark-compacts near heap limit
//
//  Reproduced locally by capping the heap: the process that dies is a
//  "Next.js build worker exited with code: 134", not the parent. Next compiles
//  and collects page data in CHILD processes, and the amount each one holds
//  depends on how many of them there are — which is derived from CPU count. A
//  many-core dev machine spreads the work thinly across several heaps; a
//  two-core builder concentrates it, so the same commit that builds locally
//  runs a worker into the default ~2 GB ceiling on Render.
//
//  ── Why a wrapper and not a flag in the npm script ────────────────────────
//  `node --max-old-space-size=N node_modules/.../next build` raises the ceiling
//  for the PARENT only. Command-line V8 flags are not inherited by spawned
//  children, and the parent is not the process that runs out of memory — so
//  that form looks like a fix, changes nothing about the worker, and the
//  deploy keeps failing in exactly the same way.
//
//  NODE_OPTIONS *is* inherited. Setting it here guarantees every worker Next
//  spawns gets the same ceiling. Verified by lowering BUILD_HEAP_MB and
//  watching a worker die at precisely that number.
//
//  ── Why a script and not an env var on the host ───────────────────────────
//  It has to hold on Render, on a laptop and in CI without anybody remembering
//  to configure it. A build that only succeeds when a dashboard setting is
//  right is a build that breaks the next time somebody creates an environment.
// ════════════════════════════════════════════════════════════════════════════

import { spawn } from "node:child_process";
import { createRequire } from "node:module";

/**
 * 4 GB.
 *
 * A CEILING, not a reservation — V8 grows into it only as needed, so this costs
 * nothing on a machine that never approaches it. Set well clear of the ~2.1 GB
 * peak the failing worker reached, because the margin is what absorbs the app
 * continuing to grow. Overridable so the limit can be lowered to reproduce the
 * failure on demand.
 */
const HEAP_MB = process.env.BUILD_HEAP_MB ?? "4096";

const flag = `--max-old-space-size=${HEAP_MB}`;
// Appended rather than replacing: a host may legitimately set its own options
// (a CA bundle, a resolver flag) and clobbering them would trade one broken
// build for another.
const existing = process.env.NODE_OPTIONS ?? "";
const nodeOptions = existing.includes("--max-old-space-size")
  ? existing // an explicit host setting wins; it was set deliberately
  : `${existing} ${flag}`.trim();

const require = createRequire(import.meta.url);
// Resolve Next's own binary rather than shelling out to `npx`, which would add
// a process, a network-capable resolver and a Windows/POSIX quoting problem.
const nextBin = require.resolve("next/dist/bin/next");

console.log(`[build] NODE_OPTIONS=${nodeOptions}`);

const child = spawn(process.execPath, [nextBin, "build"], {
  stdio: "inherit",
  env: { ...process.env, NODE_OPTIONS: nodeOptions },
});

child.on("exit", (code, signal) => {
  // 134 = SIGABRT, which is what a V8 heap OOM looks like from the outside.
  // Naming it here turns a bare exit code in a deploy log into the one sentence
  // that explains it.
  if (code === 134 || signal === "SIGABRT") {
    console.error(
      `[build] a build worker ran out of memory at ${HEAP_MB} MB.\n` +
        `[build] raise BUILD_HEAP_MB, or give the builder more RAM.`,
    );
  }
  process.exit(code ?? 1);
});
