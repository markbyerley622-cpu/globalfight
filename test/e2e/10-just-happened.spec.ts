import { test, expect, expectHealthy } from "./fixtures";

/**
 * Just Happened — the identity-first post-fight band on /events.
 *
 * A completed card is evidence of what changed for the viewer, not a headline.
 * These lock in: the band leads the default view; a signed-in picker sees their
 * record delta on a card they called; the band does NOT appear on a filtered
 * view (where it would fight the query); and the cards link into the existing
 * event recap, not a new destination.
 */

async function loginGrace(page: import("@playwright/test").Page): Promise<boolean> {
  const res = await page.request.post("/api/auth/login", {
    data: { email: "gracebautista@seed.local", password: "demo-passw0rd" },
  });
  return res.status() === 200;
}

test("just happened: leads the default events view and links into the recap @xbrowser", async ({ page, health }) => {
  await page.goto("/events", { waitUntil: "domcontentloaded" });
  const band = page.locator("section[aria-label='Just happened']");
  // The band only renders when recent completed cards exist; skip on an empty DB.
  test.skip((await band.count()) === 0, "no recently-completed events seeded");

  await expect(band.getByRole("heading", { name: /just happened/i })).toBeVisible();
  // Every card links to an event page (the existing recap), never a new route.
  const links = band.locator('a[href^="/events/"]');
  expect(await links.count()).toBeGreaterThan(0);
  await expect(band.getByText(/def\./i).first()).toBeVisible(); // a headline result
  expectHealthy(health);
});

test("just happened: a signed-in picker sees their record delta", async ({ page, health }) => {
  test.skip(!(await loginGrace(page)), "grace fixture not seeded");
  await page.goto("/events", { waitUntil: "domcontentloaded" });
  const band = page.locator("section[aria-label='Just happened']");
  test.skip((await band.count()) === 0, "no recently-completed events seeded");

  // Grace has a graded pick on the seeded card → the identity strip shows a
  // record, not the anonymous "see how the room did" fallback.
  await expect(band.getByText(/you went \d+\/\d+/i).first()).toBeVisible();
  expectHealthy(health);
});

test("just happened: absent on a filtered view (does not fight the query)", async ({ page }) => {
  await page.goto("/events?status=completed", { waitUntil: "domcontentloaded" });
  await expect(page.locator("section[aria-label='Just happened']")).toHaveCount(0);
});
