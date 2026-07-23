import { test, expect, expectHealthy, signUp, uniqueEmail, STRONG_PASSWORD } from "./fixtures";
import { PRIMARY, STORAGE_STATE } from "./global-setup";

/**
 * Phase 2 — the full authentication journey against the real API + DB.
 *
 * To respect the signup rate limit (8/hour/IP, shared localhost), only the
 * registration test creates a brand-new account. Session-persistence and logout
 * reuse the pre-authenticated primary member; login/rejection reuse the primary
 * credentials from a logged-out context.
 */

test("registration creates an account and signs the user in", async ({ page }) => {
  const email = uniqueEmail("signup");
  await signUp(page, email); // asserts logged-in (Account menu) after the 201
  // A fresh member is dropped into onboarding.
  await expect(page).toHaveURL(/\/welcome/);
  await expect(page.getByRole("heading", { name: /welcome to combat reviews/i })).toBeVisible();
});

test.describe("with an existing session", () => {
  test.use({ storageState: STORAGE_STATE });

  test("session persists across a full page reload", async ({ page }) => {
    await page.goto("/account");
    await expect(page.getByRole("button", { name: /sign out/i })).toBeVisible({ timeout: 15_000 });
    await page.reload();
    // Still logged in after reload — cookie-backed session, no re-login.
    await expect(page.getByRole("button", { name: /sign out/i })).toBeVisible({ timeout: 15_000 });
  });

  test("logout clears the session and returns to the auth form", async ({ page }) => {
    await page.goto("/account");
    await page.getByRole("button", { name: /sign out/i }).click();
    await expect(page.getByRole("button", { name: /^Create account$/i }).first()).toBeVisible({
      timeout: 15_000,
    });
  });
});

test("login works with the primary member's credentials", async ({ page }) => {
  await page.goto("/account");
  await page.getByRole("button", { name: /^Sign in$/i }).first().click();
  await page.getByLabel("Email").fill(PRIMARY.email);
  await page.getByLabel("Password").fill(PRIMARY.password);
  await page.getByRole("button", { name: /^Sign in$/i }).last().click();
  await expect(page.getByRole("button", { name: /sign out/i })).toBeVisible({ timeout: 15_000 });
});

test("wrong password is rejected without logging in", async ({ page }) => {
  await page.goto("/account");
  await page.getByRole("button", { name: /^Sign in$/i }).first().click();
  await page.getByLabel("Email").fill(PRIMARY.email);
  await page.getByLabel("Password").fill("totally-wrong-password-9x");
  await page.getByRole("button", { name: /^Sign in$/i }).last().click();
  // An error surfaces; we stay on the form (no Sign out control appears).
  await expect(page.getByRole("button", { name: /sign out/i })).toHaveCount(0);
});

test("forgot-password page loads and accepts an email", async ({ page, health }) => {
  const res = await page.goto("/account/forgot");
  expect(res!.status()).toBeLessThan(400);
  // The forgot form's input is a placeholder-only email field (no <label>).
  const emailField = page.locator('input[type="email"]').first();
  await expect(emailField).toBeVisible();
  await emailField.fill(uniqueEmail("reset"));
  const submit = page.getByRole("button").filter({ hasText: /reset|send|email|link/i }).first();
  if (await submit.count()) await submit.click();
  expectHealthy(health);
});

test("password-weakness is enforced on the signup form", async ({ page }) => {
  await page.goto("/account");
  await page.getByRole("button", { name: /^Create account$/i }).first().click().catch(() => {});
  await page.getByLabel("Username").fill("Weak Pw Tester");
  await page.getByLabel("Email").fill(uniqueEmail("weak"));
  await page.getByLabel("Password").fill("short"); // < 10 chars → client-blocked, no POST
  const boxes = page.locator('input[type="checkbox"]');
  const n = await boxes.count();
  for (let i = 0; i < n; i++) await boxes.nth(i).check();
  await page.getByRole("button", { name: /^Create account$/i }).last().click();
  await expect(page.getByRole("button", { name: /sign out/i })).toHaveCount(0);
  await expect(page.getByText(/at least 10 characters/i)).toBeVisible();
});
