import { test, expect, expectHealthy } from "./fixtures";
import { STORAGE_STATE } from "./global-setup";

/**
 * Phase 2 — the prediction habit loop. Runs as the pre-authenticated primary
 * member (shared storage state) so the suite stays under the signup rate limit.
 */
test.use({ storageState: STORAGE_STATE });

// A known scheduled (pickable) bout from the seeded world.
const PICKABLE_FIGHT = "/fights/paddy-pimblett-vs-conor-mcgregor";

test("signed-in user can submit a prediction on a scheduled bout", async ({ page }) => {
  await page.goto(PICKABLE_FIGHT);
  const makePick = page.getByText(/make your pick/i).first();
  await expect(makePick, "bout page should show the pick control").toBeVisible({ timeout: 15_000 });

  const redCorner = page.getByRole("button").filter({ hasText: /red corner/i }).first();
  await expect(redCorner).toBeVisible();

  const [pickRes] = await Promise.all([
    page.waitForResponse((r) => /\/api\/fights\/.+\/pick/.test(r.url()) && r.request().method() === "POST"),
    redCorner.click(),
  ]);
  expect(pickRes.status(), "pick POST status").toBe(200);

  // The corner is now selected and confidence stars appear.
  await expect(redCorner).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByLabel(/confidence 1 of 5/i)).toBeVisible();

  // Set confidence 4/5 and verify it round-trips.
  const [confRes] = await Promise.all([
    page.waitForResponse((r) => /\/api\/fights\/.+\/pick/.test(r.url())),
    page.getByLabel(/confidence 4 of 5/i).click(),
  ]);
  expect(confRes.status()).toBe(200);

  // Persist across reload — the server remembers the pick.
  await page.reload();
  await expect(
    page.getByRole("button").filter({ hasText: /red corner/i }).first(),
  ).toHaveAttribute("aria-pressed", "true", { timeout: 15_000 });
});

test("predictions listing renders", async ({ page, health }) => {
  await page.goto("/predictions");
  await expect(page.locator("h1").first()).toBeVisible();
  expectHealthy(health);
});

test("the member profile / prediction history page renders", async ({ page, health }) => {
  await page.goto("/profile");
  await expect(page.locator("main, h1").first()).toBeVisible();
  expectHealthy(health);
});
