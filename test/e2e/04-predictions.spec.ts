import { test, expect, expectHealthy } from "./fixtures";
import { STORAGE_STATE } from "./global-setup";

/**
 * Phase 2 — the prediction habit loop. Runs as the pre-authenticated primary
 * member (shared storage state) so the suite stays under the signup rate limit.
 */
test.use({ storageState: STORAGE_STATE });

// The canonical seeded bout — a deterministic id from prisma/seed/e2e, not a
// hardcoded slug from whatever data the database happened to hold. The previous
// value ("paddy-pimblett-vs-conor-mcgregor") had no row behind it, so this test
// was asserting against a 404 long before the UX changed.
const PICKABLE_FIGHT = "/fights/e2e-fight-upcoming";

/**
 * The prediction flow, as it actually works: PICK A CORNER, then CHOOSE THE
 * FINISH — and the finish is what commits.
 *
 * This test previously encoded the old one-tap UX (a "red corner" button that
 * POSTed immediately, then five confidence stars). All three of those are gone:
 * confidence was removed, the corner no longer writes, and the labels changed.
 * Rewritten rather than re-snapshotted, because the failure was real — the test
 * was describing a product that no longer exists.
 */
test("a signed-in member picks a corner, chooses the finish, and it persists", async ({ page }) => {
  await page.goto(PICKABLE_FIGHT);

  const red = page.locator('[data-testid="corner-pick"][data-corner="RED"]').first();
  await expect(red, "bout page should show the pick control").toBeVisible({ timeout: 15_000 });

  // NO assertion on the starting state, deliberately. This test WRITES a pick,
  // so on a second run against the same database the bout is already called —
  // and a test that only passes against a freshly seeded row is a test that
  // will fail the first time someone runs the suite twice. CI re-seeds before
  // every run; this stays correct either way. What is verified below is the
  // TRANSITION, which holds from either starting state.

  // STEP 1 — tapping the corner must NOT write. It opens the finish chooser.
  let wrote = false;
  const watch = (r: import("@playwright/test").Request) => {
    if (r.method() === "POST" && /\/api\/fights\/.+\/pick/.test(r.url())) wrote = true;
  };
  page.on("request", watch);
  await red.click();
  await expect(red).toHaveAttribute("data-pending", "true");
  await expect(page.locator('[data-testid="finish-choice"]')).toHaveCount(3);
  expect(wrote, "tapping a corner must not commit a pick").toBe(false);
  page.off("request", watch);

  // STEP 2 — the finish commits it.
  const [pickRes] = await Promise.all([
    page.waitForResponse((r) => /\/api\/fights\/.+\/pick/.test(r.url()) && r.request().method() === "POST"),
    page.locator('[data-testid="finish-choice"][data-method="KO"]').click(),
  ]);
  expect(pickRes.status(), "pick POST status").toBe(200);
  await expect(red).toHaveAttribute("data-picked", "true");

  // The server remembers it across a reload.
  await page.reload();
  await expect(
    page.locator('[data-testid="corner-pick"][data-corner="RED"]').first(),
  ).toHaveAttribute("data-picked", "true", { timeout: 15_000 });
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
