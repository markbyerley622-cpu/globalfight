import { test, expect } from "./fixtures";

/**
 * Phase 5 — visual QA capture across three breakpoints. This is evidence
 * capture (full-page screenshots for human review) plus automated guards for
 * the defects that are machine-detectable: horizontal overflow (layout break)
 * and a rendered <main>. Screenshots land in test/e2e/screenshots/.
 */

const VIEWPORTS = [
  { name: "desktop", width: 1440, height: 900 },
  { name: "tablet", width: 834, height: 1112 },
  { name: "mobile", width: 390, height: 844 },
];

const ROUTES = [
  ["landing", "/"],
  ["events", "/events"],
  ["fighters", "/fighters"],
  ["leaderboard", "/leaderboard"],
  ["predictions", "/predictions"],
  ["community", "/community"],
  ["account", "/account"],
];

for (const vp of VIEWPORTS) {
  test.describe(`${vp.name} (${vp.width}px)`, () => {
    test.use({ viewport: { width: vp.width, height: vp.height } });

    for (const [name, path] of ROUTES) {
      test(`visual: ${name}`, async ({ page }) => {
        await page.goto(path, { waitUntil: "networkidle" }).catch(() => page.goto(path));
        await page.locator("main, h1").first().waitFor({ timeout: 15_000 });
        // Let fonts/animations settle.
        await page.waitForTimeout(600);

        await page.screenshot({
          path: `test/e2e/screenshots/${name}-${vp.name}.png`,
          fullPage: true,
        });

        // No horizontal overflow: body should not scroll sideways past the viewport.
        const overflow = await page.evaluate(() => {
          const doc = document.documentElement;
          return { scrollW: doc.scrollWidth, clientW: doc.clientWidth };
        });
        expect(
          overflow.scrollW,
          `${name} @ ${vp.name}: horizontal overflow (scrollW ${overflow.scrollW} > clientW ${overflow.clientW})`,
        ).toBeLessThanOrEqual(overflow.clientW + 2); // 2px tolerance for sub-pixel rounding
      });
    }
  });
}
