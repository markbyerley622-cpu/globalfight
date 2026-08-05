import AxeBuilder from "@axe-core/playwright";
import { test, expect, expectHealthy, uniqueEmail, STRONG_PASSWORD } from "./fixtures";
import type { Cookie, Page } from "@playwright/test";

/**
 * /today — the daily identity surface.
 *
 * This is the retention loop: a streak that moves because the user turned up, a
 * digest of what changed while they were away, and the collection rungs they
 * are closest to. It writes to `User.lastActiveOn/dayStreak/bestDayStreak/
 * activeDays` on every first visit of a day, so it is the one read-shaped page
 * in the product with a side effect — the streak assertions below are the
 * regression net for that write.
 *
 * Three states are covered because they render genuinely different pages:
 *   empty    a brand-new account — every ladder on rung one, every list empty
 *   growing  some follows and picks — mixed empty/populated sections
 *   power    hundreds of follows, a long streak, a gym (fixture-dependent)
 *
 * The `growing`/`power` personas come from scripts/tmp-verify-fixtures.mts and
 * are SKIPPED (not failed) when absent, so a clean database still runs green.
 */

const PERSONAS = {
  growing: { email: "verify-growing@seed.local", password: "demo-passw0rd" },
  power: { email: "verify-power@seed.local", password: "demo-passw0rd" },
};

/** Log in through the API on the page's own cookie jar. False if absent. */
async function loginAs(page: Page, who: keyof typeof PERSONAS): Promise<boolean> {
  const res = await page.request.post("/api/auth/login", { data: PERSONAS[who] });
  return res.status() === 200;
}

// ONE fresh account per run, shared by the empty-state tests. Signup is rate
// limited per IP (POLICY.signup) and every test here shares localhost, so a
// signup per test burns the budget and turns a healthy limiter into a red suite.
let freshCookies: Cookie[] | null = null;
let signupThrottled = false;

/**
 * Put a brand-new account's session on this page. Returns false when signup is
 * rate limited — the caller skips rather than fails, because a working limiter
 * is not a defect in the page under test.
 */
async function useFreshAccount(page: Page): Promise<boolean> {
  if (signupThrottled) return false;
  if (freshCookies) {
    await page.context().addCookies(freshCookies);
    return true;
  }
  const res = await page.request.post("/api/auth/signup", {
    data: {
      name: "Today Verifier",
      email: uniqueEmail("today"),
      password: STRONG_PASSWORD,
      registryRole: "fan",
      ageConfirmed: true, termsAccepted: true,
    },
  });
  if (res.status() === 429) {
    signupThrottled = true;
    return false;
  }
  expect(res.status(), await res.text()).toBe(201);
  // page.request shares the context's cookie jar, so the session is already here.
  freshCookies = await page.context().cookies();
  return true;
}

/**
 * The streak headline, as an integer. Located by its visible text rather than a
 * test id — the codebase has no data-testid convention and this sign-off is not
 * the place to introduce one.
 */
async function streakValue(page: Page): Promise<number> {
  const line = page.locator("main p", { hasText: /days? running/i }).first();
  const match = (await line.innerText()).match(/(\d[\d,]*)/);
  return Number((match?.[1] ?? "").replace(/,/g, ""));
}

// ── Signed out ──────────────────────────────────────────────────────────────

test("today: signed out shows the pitch and leaks no personal data @xbrowser", async ({ page, health }) => {
  await page.goto("/today", { waitUntil: "domcontentloaded" });
  await expect(page.getByText(/your combat life, one page/i)).toBeVisible();
  // No streak block, no reputation, no digest — an anonymous request must not
  // render another user's surface under any caching.
  await expect(page.locator("main p", { hasText: /days? running/i })).toHaveCount(0);
  await expect(page.getByText(/close to done/i)).toHaveCount(0);
  expectHealthy(health);
});

// ── Empty state ─────────────────────────────────────────────────────────────

test("today: a brand-new account renders day one with honest empty states", async ({ page, health }) => {
  test.skip(!(await useFreshAccount(page)), "signup rate-limited on this IP");
  await page.goto("/today", { waitUntil: "domcontentloaded" });

  await expect(page.getByRole("heading", { name: /^today/i })).toBeVisible();
  expect(await streakValue(page)).toBe(1);
  await expect(page.getByText(/this is day one/i)).toBeVisible();

  // A first visit has no "last visit" to have been quiet since.
  await expect(page.getByText(/quiet since your last visit/i)).toHaveCount(0);
  await expect(page.getByText(/nothing to catch up on/i)).toBeVisible();

  // Following nobody must not be described as "every fighter you follow is called".
  await expect(page.getByText(/every fighter you follow is called/i)).toHaveCount(0);

  // Every ladder sits on rung one, so every line must read singular. (The line
  // appears twice — once in "Close to done", once on the collections board.)
  await expect(page.getByText(/that's 1 fights called/i)).toHaveCount(0);
  await expect(page.getByText(/that's 1 fight called/i).first()).toBeVisible();

  expectHealthy(health);
});

test("today: the streak counts a day once, however many times it is opened", async ({ page, health }) => {
  test.skip(!(await useFreshAccount(page)), "signup rate-limited on this IP");
  await page.goto("/today", { waitUntil: "domcontentloaded" });
  const first = await streakValue(page);

  await page.reload({ waitUntil: "domcontentloaded" });
  expect(await streakValue(page), "a second visit the same day must not advance the streak").toBe(first);
  // The celebration is the first-visit-of-the-day signal; it must not repeat.
  await expect(page.getByText(/logged\. come back tomorrow/i)).toHaveCount(0);

  expectHealthy(health);
});

// ── Populated states ────────────────────────────────────────────────────────

for (const who of ["growing", "power"] as const) {
  test(`today: the ${who} account renders cleanly`, async ({ page, health }) => {
    test.skip(!(await loginAs(page, who)), `${who} fixture not seeded`);
    await page.goto("/today", { waitUntil: "domcontentloaded" });
    await page.locator("main h1").waitFor();

    await expect(page.getByRole("heading", { name: /^today/i })).toBeVisible();
    expect(await streakValue(page)).toBeGreaterThanOrEqual(1);
    // Standing row always renders for a signed-in user.
    await expect(page.getByText(/reputation/i).first()).toBeVisible();
    await expect(page.getByText(/collections/i).first()).toBeVisible();

    expectHealthy(health);
  });
}

test("today: every link on a populated page points at a route that resolves", async ({ page }) => {
  test.skip(!(await loginAs(page, "power")), "power fixture not seeded");
  await page.goto("/today", { waitUntil: "domcontentloaded" });
  await page.locator("main h1").waitFor();

  // The app shell renders the site footer INSIDE <main>, so an unscoped crawl
  // would be checking the whole site's nav, not this page's links.
  const hrefs = new Set(
    (
      await page.locator('main a[href^="/"]').evaluateAll((els) =>
        els.filter((e) => !e.closest("footer")).map((e) => e.getAttribute("href") ?? ""),
      )
    ).filter(Boolean),
  );
  expect(hrefs.size).toBeGreaterThan(5);

  const broken: string[] = [];
  for (const href of hrefs) {
    const res = await page.request.get(href, { maxRedirects: 5 });
    if (res.status() >= 400) broken.push(`${res.status()} ${href}`);
  }
  expect(broken, `dead links on /today:\n${broken.join("\n")}`).toEqual([]);
});

// ── Layout ──────────────────────────────────────────────────────────────────

for (const [label, viewport] of [
  ["mobile", { width: 390, height: 844 }],
  ["desktop", { width: 1440, height: 900 }],
] as const) {
  test(`today: ${label} layout does not scroll horizontally @mobile`, async ({ page, health }) => {
    test.skip(!(await loginAs(page, "power")), "power fixture not seeded");
    await page.setViewportSize(viewport);
    await page.goto("/today", { waitUntil: "domcontentloaded" });
    await page.locator("main").waitFor();

    // Horizontal overflow on a phone is the failure mode a stat row or a long
    // fighter name causes, and it is invisible in a desktop-only check.
    const overflow = await page.evaluate(() => {
      const el = document.scrollingElement ?? document.documentElement;
      return el.scrollWidth - el.clientWidth;
    });
    expect(overflow, `${label} page overflows horizontally by ${overflow}px`).toBeLessThanOrEqual(1);

    await expect(page.getByRole("heading", { name: /^today/i })).toBeVisible();
    expectHealthy(health);
  });
}

// ── Accessibility ───────────────────────────────────────────────────────────

test("today: no serious or critical axe violations", async ({ page }, testInfo) => {
  test.skip(!(await loginAs(page, "power")), "power fixture not seeded");
  await page.goto("/today", { waitUntil: "domcontentloaded" });
  await page.locator("main, h1").first().waitFor({ timeout: 15_000 });

  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
    .analyze();

  const serious = results.violations.filter((v) => v.impact === "critical" || v.impact === "serious");
  const minor = results.violations.filter((v) => v.impact === "moderate" || v.impact === "minor");

  testInfo.annotations.push({
    type: "axe-summary",
    description: `/today: ${serious.length} serious/critical, ${minor.length} moderate/minor`,
  });
  for (const v of results.violations) {
    testInfo.annotations.push({ type: `axe-${v.impact}`, description: `${v.id} (${v.nodes.length}×): ${v.help}` });
  }

  expect(
    serious,
    `serious/critical a11y violations on /today:\n` +
      serious.map((v) => `  • ${v.id}: ${v.help} [${v.nodes.length} nodes]`).join("\n"),
  ).toEqual([]);
});
