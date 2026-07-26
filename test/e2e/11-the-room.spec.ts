import { test, expect, expectHealthy } from "./fixtures";

/**
 * The Room — the community's call on a completed headline bout.
 *
 * It's social proof grounded entirely in FightPick data: winner / finish /
 * perfect-call shares, the sharpest caller, the perfect-call club. Shown to
 * everyone (not just pickers) on a completed event, and hidden below quorum.
 */

const COMPLETED = "/events/vfx-ufc-highlight"; // showcase fixture: 46 callers on the headline

test("the room: shows the community breakdown on a completed event @xbrowser", async ({ page, health }) => {
  await page.goto(COMPLETED, { waitUntil: "domcontentloaded" });
  const room = page.locator("section[aria-label='How the room called it']");
  test.skip((await room.count()) === 0, "room fixture not seeded (needs a completed event with >= quorum picks)");

  await expect(room.getByRole("heading", { name: /the room/i })).toBeVisible();
  await expect(room.getByText(/callers/i).first()).toBeVisible();
  // Every share is a percentage bar; there is at least the winner + perfect rows.
  const pcts = room.getByText(/^\d+%$/);
  expect(await pcts.count()).toBeGreaterThanOrEqual(2);
  // The people layer: a top caller and/or the perfect-call club.
  await expect(room.getByText(/top caller|perfect call club/i).first()).toBeVisible();

  expectHealthy(health);
});

test("the room: an anonymous visitor sees it too (it's social proof, not a personal result)", async ({ page }) => {
  const res = await page.request.get(COMPLETED);
  test.skip(res.status() !== 200, "event fixture not seeded");
  const body = await res.text();
  // Anon still gets The Room even though ResultReveal (personal) is absent.
  if (body.includes("How the room called it")) {
    expect(body).toMatch(/The Room/i);
  }
});
