import { test, expect, expectHealthy } from "./fixtures";

/**
 * Phase 2 — primary navigation + runtime health across every public route.
 * A route "passes" only if it returns 200-level content, renders a <main>/<h1>,
 * and produces no page exceptions, console errors, or failed API requests.
 */

const PUBLIC_ROUTES: { path: string; name: string }[] = [
  { path: "/", name: "Landing" },
  { path: "/home", name: "Home feed" },
  { path: "/events", name: "Event discovery" },
  { path: "/schedule", name: "Schedule" },
  { path: "/results", name: "Results" },
  { path: "/fighters", name: "Fighters" },
  { path: "/rankings", name: "Rankings" },
  { path: "/p4p", name: "Pound-for-pound" },
  { path: "/champions", name: "Champions" },
  { path: "/leaderboard", name: "Leaderboard" },
  { path: "/predictions", name: "Predictions" },
  { path: "/community", name: "Community" },
  { path: "/forums", name: "Forums" },
  { path: "/news", name: "News" },
  { path: "/gyms", name: "Gyms" },
  { path: "/map", name: "Map" },
  { path: "/search", name: "Search" },
  { path: "/registry", name: "Registry" },
  { path: "/account", name: "Account / Auth" },
  { path: "/welcome", name: "Onboarding welcome" },
];

test("@xbrowser landing page renders and links into the app", async ({ page, health }) => {
  const res = await page.goto("/");
  expect(res?.status(), "landing HTTP status").toBeLessThan(400);
  await expect(page.locator("main, [role=main]").first()).toBeVisible();
  // Primary CTA / nav into the product should exist.
  await expect(page.locator("a[href]").first()).toBeVisible();
  expectHealthy(health);
});

for (const route of PUBLIC_ROUTES) {
  test(`route health: ${route.name} (${route.path})`, async ({ page, health }) => {
    const res = await page.goto(route.path, { waitUntil: "domcontentloaded" });
    expect(res, `no response for ${route.path}`).not.toBeNull();
    expect(res!.status(), `${route.path} status`).toBeLessThan(400);
    // No infinite loading / visual dead end: a landmark heading or main content.
    await expect(
      page.locator("main, [role=main], h1").first(),
      `${route.path} rendered no main/h1`,
    ).toBeVisible({ timeout: 15_000 });
    expectHealthy(health);
  });
}
