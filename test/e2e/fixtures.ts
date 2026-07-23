import { test as base, expect, type Page } from "@playwright/test";

/**
 * Every test gets automatic runtime-health capture:
 *   • console.error / console.warn (hydration mismatches log as errors/warnings)
 *   • uncaught page exceptions
 *   • failed network responses (>=500, and 4xx on same-origin navigations)
 *
 * A test that navigates cleanly still FAILS if the page threw or logged errors —
 * that is the Phase-2 "no runtime exceptions / no console errors" gate.
 */
export type HealthLog = {
  consoleErrors: string[];
  pageErrors: string[];
  failedRequests: string[];
};

// Known-benign noise we do not want to fail the whole suite on. Kept tiny and
// explicit — every entry is a deliberate allow, not a blanket mute.
const IGNORED_CONSOLE = [
  /Download the React DevTools/i,
  /\[Fast Refresh\]/i,
  // Leaflet tile CDN can be unreachable in a sandbox; the map still renders.
  /basemaps\.cartocdn\.com/i,
  /Failed to load resource.*tile/i,
  // The CSP is intentionally Report-Only until the nonce work lands (next.config.ts
  // / HARDENING.md Fix 2). Different browsers log that specific directives
  // (upgrade-insecure-requests, frame-ancestors, …) have no effect in Report-Only
  // mode — all expected consequences of that posture, not page defects. The
  // enforced clickjacking control ships separately as `X-Frame-Options: DENY`.
  /is ignored when delivered in a report-only policy/i,
  // Firefox/WebKit also note the Report-Only CSP has no report-uri/report-to.
  // True (a telemetry endpoint is a documented follow-up for the enforcement work).
  /Report-Only policy without a report-uri/i,
  // Report-Only CSP "Refused to load" notices are telemetry, not current breakage
  // (nothing is blocked in Report-Only mode). They flag external image hosts —
  // event posters (cdn.onefc.com …), video thumbnails (i.ytimg.com) — that must be
  // added to img-src OR proxied through /api/img BEFORE the CSP is enforced. That
  // img-src audit is the tracked pre-enforcement task; it is not a runtime defect.
  /\[Report Only\] Refused to load/i,
];

const IGNORED_REQUESTS = [
  /basemaps\.cartocdn\.com/i,
  /\/api\/img\b/i, // image proxy — remote photos may 404 in a seeded-but-photoless DB
  /\.(png|jpg|jpeg|webp|avif|svg|ico)(\?|$)/i,
];

export const test = base.extend<{ health: HealthLog }>({
  health: async ({ page }, use) => {
    const log: HealthLog = { consoleErrors: [], pageErrors: [], failedRequests: [] };

    page.on("console", (msg) => {
      if (msg.type() !== "error" && msg.type() !== "warning") return;
      const text = msg.text();
      if (IGNORED_CONSOLE.some((re) => re.test(text))) return;
      log.consoleErrors.push(`[${msg.type()}] ${text}`);
    });

    page.on("pageerror", (err) => {
      log.pageErrors.push(err.message);
    });

    page.on("response", (res) => {
      const url = res.url();
      const status = res.status();
      if (status < 400) return;
      if (IGNORED_REQUESTS.some((re) => re.test(url))) return;
      // A 401 on /api/auth/me before login is expected; allow it.
      if (status === 401 && /\/api\/auth\/me/.test(url)) return;
      log.failedRequests.push(`${status} ${url}`);
    });

    await use(log);
  },
});

/** Assert the captured health log is clean. Call at the end of a test. */
export function expectHealthy(health: HealthLog) {
  expect(health.pageErrors, `uncaught page exceptions:\n${health.pageErrors.join("\n")}`).toEqual([]);
  expect(
    health.consoleErrors,
    `console errors/warnings:\n${health.consoleErrors.join("\n")}`,
  ).toEqual([]);
  expect(
    health.failedRequests,
    `failed network requests:\n${health.failedRequests.join("\n")}`,
  ).toEqual([]);
}

/** A password that satisfies the app policy (>=10 chars, >=5 unique, not common). */
export const STRONG_PASSWORD = "CertPass2026x!";

/** Unique email per run — index keeps parallel/retried tests from colliding. */
export function uniqueEmail(tag: string): string {
  // Date.now/Math.random are fine in Playwright (not a workflow script).
  return `cert.${tag}.${Date.now()}.${Math.floor(Math.random() * 1e6)}@seed.local`;
}

/** Sign up a fresh account through the real /account form. Leaves you logged in. */
export async function signUp(page: Page, email: string): Promise<void> {
  await page.goto("/account");
  // Default mode is "signup". Ensure it.
  const createTab = page.getByRole("button", { name: /^Create account$/i }).first();
  await createTab.click().catch(() => {});
  await page.getByLabel("Username").fill(`Cert User ${Date.now() % 100000}`);
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(STRONG_PASSWORD);
  // Two required checkboxes: age + registry consent.
  const boxes = page.locator('input[type="checkbox"]');
  const count = await boxes.count();
  for (let i = 0; i < count; i++) await boxes.nth(i).check();
  // Wait on the signup API response (the true success signal) then the UI — the
  // client dashboard re-render can lag under heavy parallel load.
  const [res] = await Promise.all([
    page.waitForResponse((r) => /\/api\/auth\/signup/.test(r.url()) && r.request().method() === "POST", { timeout: 20_000 }),
    page.getByRole("button", { name: /^Create account$/i }).last().click(),
  ]);
  if (res.status() !== 201) throw new Error(`signup expected 201, got ${res.status()}: ${await res.text()}`);
  // A fresh signup redirects into onboarding (/welcome). The reliable logged-in
  // signal on ANY page is the header "Account menu" control.
  await expect(page.getByRole("button", { name: /account menu/i })).toBeVisible({ timeout: 20_000 });
}

export { expect };
