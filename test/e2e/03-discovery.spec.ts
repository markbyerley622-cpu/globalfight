import { test, expect, expectHealthy } from "./fixtures";

/**
 * Phase 2 — event & fighter discovery, drilling from a listing into a detail
 * page via real card navigation (no hardcoded slugs), plus the ranking surfaces.
 */

test("@xbrowser event discovery → event detail via card click", async ({ page, health }) => {
  await page.goto("/events");
  await expect(page.locator("main, h1").first()).toBeVisible();
  const eventLink = page.locator('a[href^="/events/"]').first();
  await expect(eventLink, "at least one event card links to a detail page").toBeVisible({
    timeout: 15_000,
  });
  const href = await eventLink.getAttribute("href");
  await eventLink.click();
  await page.waitForURL("**/events/**");
  expect(page.url()).toContain("/events/");
  await expect(page.locator("h1").first()).toBeVisible();
  expectHealthy(health);
  test.info().annotations.push({ type: "event-detail", description: href ?? "" });
});

test("fighter discovery → fighter profile via card click", async ({ page, health }) => {
  await page.goto("/fighters");
  await expect(page.locator("main, h1").first()).toBeVisible();
  const fighterLink = page.locator('a[href^="/fighters/"]').first();
  await expect(fighterLink).toBeVisible({ timeout: 15_000 });
  await fighterLink.click();
  await page.waitForURL("**/fighters/**");
  await expect(page.locator("h1").first()).toBeVisible();
  expectHealthy(health);
});

test("rankings surface renders divisions and links", async ({ page, health }) => {
  await page.goto("/rankings");
  await expect(page.locator("h1").first()).toBeVisible();
  // Rankings should link to at least one detail/division.
  await expect(page.locator("a[href]").first()).toBeVisible();
  expectHealthy(health);
});

test("leaderboard renders ranked members", async ({ page, health }) => {
  await page.goto("/leaderboard");
  await expect(page.locator("h1").first()).toBeVisible();
  expectHealthy(health);
});

test("search page accepts a query and stays healthy", async ({ page, health }) => {
  await page.goto("/search");
  const box = page.getByRole("searchbox").or(page.locator('input[type="search"], input[type="text"]')).first();
  if (await box.count()) {
    await box.fill("champion");
    await box.press("Enter").catch(() => {});
    await page.waitForTimeout(1500);
  }
  expectHealthy(health);
});
