import { defineConfig, devices } from "@playwright/test";

/**
 * RC-1 certification E2E config.
 *
 * The server is started out-of-band (production `next start` against the
 * disposable Postgres) so its stdout/stderr can be captured for runtime
 * validation (Phase 6). Point BASE_URL at it; default is localhost:3000.
 *
 * Browsers: Chromium is the primary matrix (all specs). Firefox + WebKit run a
 * smoke subset (tag @xbrowser) for compatibility evidence without tripling the
 * full-suite wall-clock.
 */
const BASE_URL = process.env.BASE_URL ?? "http://localhost:3000";

export default defineConfig({
  testDir: "./test/e2e",
  outputDir: "./test/e2e/.artifacts",
  globalSetup: "./test/e2e/global-setup.ts",
  timeout: 45_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  forbidOnly: true,
  retries: 1,
  reporter: [
    ["list"],
    ["html", { outputFolder: "test/e2e/report", open: "never" }],
    ["json", { outputFile: "test/e2e/results.json" }],
  ],
  use: {
    baseURL: BASE_URL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "off",
    actionTimeout: 12_000,
    navigationTimeout: 20_000,
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
    {
      name: "firefox",
      use: { ...devices["Desktop Firefox"] },
      grep: /@xbrowser/,
    },
    {
      name: "webkit",
      use: { ...devices["Desktop Safari"] },
      grep: /@xbrowser/,
    },
    {
      name: "mobile",
      use: { ...devices["Pixel 7"] },
      grep: /@mobile/,
    },
  ],
});
