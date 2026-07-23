import { test, expect, expectHealthy } from "./fixtures";
import { STORAGE_STATE } from "./global-setup";

/**
 * Phase 2 — community surfaces: forums (category → thread), community hub, news,
 * gyms, plus the signed-in profile/settings + security pages.
 */

test("@xbrowser forums list categories and drill into one", async ({ page, health }) => {
  await page.goto("/forums");
  await expect(page.locator("h1").first()).toBeVisible();
  const category = page.locator('a[href^="/forums/"]').first();
  await expect(category).toBeVisible({ timeout: 15_000 });
  await category.click();
  await page.waitForURL("**/forums/**");
  await expect(page.locator("h1, main").first()).toBeVisible();
  expectHealthy(health);
});

test("community hub renders", async ({ page, health }) => {
  await page.goto("/community");
  await expect(page.locator("main, h1").first()).toBeVisible();
  expectHealthy(health);
});

test("news index renders and opens an article", async ({ page, health }) => {
  await page.goto("/news");
  await expect(page.locator("h1").first()).toBeVisible();
  const article = page.locator('a[href^="/news/"]').first();
  if (await article.count()) {
    // Cards carry a hover-scale animation that defeats click-stability; navigate
    // by href instead — this still verifies the article route renders.
    const href = await article.getAttribute("href");
    await page.goto(href!);
    await expect(page.locator("h1, main").first()).toBeVisible();
  }
  expectHealthy(health);
});

test("gyms directory renders", async ({ page, health }) => {
  await page.goto("/gyms");
  await expect(page.locator("main, h1").first()).toBeVisible();
  expectHealthy(health);
});

test.describe("signed-in settings", () => {
  test.use({ storageState: STORAGE_STATE });

  test("profile settings (edit) renders", async ({ page, health }) => {
    await page.goto("/profile/edit");
    await expect(page.locator("main, h1, form").first()).toBeVisible();
    expectHealthy(health);
  });

  test("account security settings page renders", async ({ page, health }) => {
    await page.goto("/account/security");
    await expect(page.locator("main, h1, form").first()).toBeVisible();
    expectHealthy(health);
  });
});
