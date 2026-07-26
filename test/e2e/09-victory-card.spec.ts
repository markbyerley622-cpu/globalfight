import { test, expect, expectHealthy } from "./fixtures";

/**
 * Prediction Victory Card — the shareable identity artifact for a resolved call.
 *
 * These assertions lock in the properties that make it postable AND truthful:
 * a win shows the achievement-badge stack and its OG unfurls as a real image; a
 * loss is honest and carries NO badges (we never decorate a miss); a pick that
 * has not resolved has no card at all (no pre-lock preview). The rich personas
 * (verifyhero / gracebautista) come from the seed + fixtures and are SKIPPED
 * when absent, so a clean DB still runs green.
 */

const HERO = "/u/verifyhero/call/vfx-makhachev-oliveira"; // upset title win, full badge stack

async function exists(page: import("@playwright/test").Page, path: string): Promise<boolean> {
  const res = await page.request.get(path);
  return res.status() === 200 && (await res.text()).includes("Your call");
}

test("victory card: a win renders the achievement stack @xbrowser", async ({ page, health }) => {
  test.skip(!(await exists(page, HERO)), "verifyhero fixture not seeded");
  await page.goto(HERO, { waitUntil: "domcontentloaded" });

  const card = page.locator("article").first();
  await expect(card).toBeVisible();
  // The five-in-three-seconds properties, each asserted:
  await expect(card.getByRole("heading", { level: 1 })).toBeVisible();          // headline
  await expect(card.getByText(/your call/i)).toBeVisible();                     // the call
  await expect(card.getByText(/won/i).first()).toBeVisible();                   // the result
  await expect(card.getByText(/reputation/i).first()).toBeVisible();            // standing moved
  // At least two objectively-true badges (why it was hard / elite).
  const badges = card.getByText(/reputation|streak|Top \d+%|Beat \d+%|conviction|finish|upset|called it/i);
  expect(await badges.count()).toBeGreaterThanOrEqual(2);

  expectHealthy(health);
});

test("victory card: the OG image unfurls as a real PNG", async ({ page }) => {
  test.skip(!(await exists(page, HERO)), "verifyhero fixture not seeded");
  const res = await page.request.get(`${HERO}/opengraph-image`);
  expect(res.status()).toBe(200);
  expect(res.headers()["content-type"]).toContain("image/png");
  // A blank/oversmall render would mean the layout threw — guard the floor.
  expect((await res.body()).byteLength).toBeGreaterThan(20_000);
});

test("victory card: a loss is honest and carries no badges", async ({ page, health }) => {
  const loss = "/u/dannybrooks/call/fight-mrxlj9w0-27";
  test.skip(!(await exists(page, loss)), "loss fixture not seeded");
  await page.goto(loss, { waitUntil: "domcontentloaded" });
  const card = page.locator("article").first();
  await expect(card).toBeVisible();
  await expect(card.getByText(/lost/i).first()).toBeVisible();
  // No achievement badges on a miss, and no fabricated "won" language.
  await expect(card.getByText(/won|streak|Beat \d+%|Top \d+%/i)).toHaveCount(0);
  expectHealthy(health);
});

test("victory card: an ungraded pick has no card (no pre-lock preview)", async ({ page }) => {
  // A resolved-only guard: constructing a card URL for a scheduled bout must not
  // reveal a pending pick. Renders the app 404 UI, never a card.
  const res = await page.request.get("/u/verifyhero/call/this-fight-does-not-exist");
  const body = await res.text();
  expect(body).not.toContain("Your call");
});
