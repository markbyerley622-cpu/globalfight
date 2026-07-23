import AxeBuilder from "@axe-core/playwright";
import { test, expect } from "./fixtures";

/**
 * Phase 4 — automated accessibility (axe-core, WCAG 2.1 A/AA) across the key
 * surfaces, plus keyboard focus checks. Serious/critical violations fail the
 * suite; minor/moderate are reported as annotations for manual review.
 */

const A11Y_ROUTES = [
  { path: "/", name: "Landing" },
  { path: "/events", name: "Events" },
  { path: "/fighters", name: "Fighters" },
  { path: "/leaderboard", name: "Leaderboard" },
  { path: "/predictions", name: "Predictions" },
  { path: "/community", name: "Community" },
  { path: "/account", name: "Account" },
];

for (const route of A11Y_ROUTES) {
  test(`a11y: ${route.name} has no serious/critical axe violations`, async ({ page }, testInfo) => {
    await page.goto(route.path, { waitUntil: "domcontentloaded" });
    await page.locator("main, h1").first().waitFor({ timeout: 15_000 });

    const results = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
      .analyze();

    const bySeverity = (impact: string) =>
      results.violations.filter((v) => v.impact === impact);

    const serious = [...bySeverity("critical"), ...bySeverity("serious")];
    const minor = [...bySeverity("moderate"), ...bySeverity("minor")];

    // Attach the full breakdown as evidence regardless of pass/fail.
    testInfo.annotations.push({
      type: "axe-summary",
      description: `${route.name}: ${serious.length} serious/critical, ${minor.length} moderate/minor`,
    });
    for (const v of results.violations) {
      testInfo.annotations.push({
        type: `axe-${v.impact}`,
        description: `${v.id} (${v.nodes.length}×): ${v.help}`,
      });
    }

    expect(
      serious,
      `serious/critical a11y violations on ${route.path}:\n` +
        serious.map((v) => `  • ${v.id}: ${v.help} [${v.nodes.length} nodes]`).join("\n"),
    ).toEqual([]);
  });
}

test("keyboard: primary nav is reachable and focus is visible", async ({ page }) => {
  await page.goto("/");
  // Tab a few times; an interactive element must receive focus.
  let focusedTag = "";
  for (let i = 0; i < 8; i++) {
    await page.keyboard.press("Tab");
    focusedTag = await page.evaluate(() => document.activeElement?.tagName ?? "");
    if (["A", "BUTTON", "INPUT"].includes(focusedTag)) break;
  }
  expect(["A", "BUTTON", "INPUT"]).toContain(focusedTag);

  // The focused element should have a visible focus indicator (outline or ring).
  const hasFocusStyle = await page.evaluate(() => {
    const el = document.activeElement as HTMLElement | null;
    if (!el) return false;
    const s = getComputedStyle(el);
    return s.outlineStyle !== "none" || s.boxShadow !== "none" || el.className.includes("focus");
  });
  expect(hasFocusStyle).toBeTruthy();
});
