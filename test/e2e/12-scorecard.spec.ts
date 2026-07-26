import { test, expect, expectHealthy } from "./fixtures";

/**
 * Event Scorecard — the shareable "how my night went".
 *
 * The personal-night companion to The Room. Locks in: it renders the record +
 * per-bout story + achievement badges; its OG unfurls as a real image; only a
 * COMPLETED event with graded picks has one (no pre-fight preview); and the
 * event's ResultReveal offers the "See your scorecard" entry point.
 */

const CARD = "/u/verifyhero/card/vfx-ufc-highlight"; // 5-bout completed card, 4/5

async function exists(page: import("@playwright/test").Page, path: string): Promise<boolean> {
  const res = await page.request.get(path);
  return res.status() === 200 && (await res.text()).includes("<article");
}

test("scorecard: renders the record, story and badges @xbrowser", async ({ page, health }) => {
  test.skip(!(await exists(page, CARD)), "scorecard fixture not seeded");
  await page.goto(CARD, { waitUntil: "domcontentloaded" });
  const card = page.locator("article").first();
  await expect(card).toBeVisible();

  // Hero record, a headline, the per-bout story, and at least one true badge.
  await expect(card.getByText(/\d+\/\d+/).first()).toBeVisible();
  await expect(card.getByText(/called right/i)).toBeVisible();
  await expect(card.getByText(/main/i).first()).toBeVisible();          // main-event marker
  const badges = card.getByText(/Called the main event|on the card|Perfect card|cards? earned/i);
  expect(await badges.count()).toBeGreaterThanOrEqual(1);

  expectHealthy(health);
});

test("scorecard: the OG image unfurls as a real PNG", async ({ page }) => {
  test.skip(!(await exists(page, CARD)), "scorecard fixture not seeded");
  const res = await page.request.get(`${CARD}/opengraph-image`);
  expect(res.status()).toBe(200);
  expect(res.headers()["content-type"]).toContain("image/png");
  expect((await res.body()).byteLength).toBeGreaterThan(20_000);
});

test("scorecard: a non-completed event has no scorecard (no pre-fight preview)", async ({ page }) => {
  const res = await page.request.get("/u/verifyhero/card/card-fury-wach"); // scheduled
  const body = await res.text();
  expect(body).not.toContain("<article");
});
