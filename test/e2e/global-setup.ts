import { request } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

/**
 * Create ONE primary member up-front and persist its authenticated storage
 * state. Logged-in specs reuse it instead of each signing up — mirroring real
 * usage and keeping the run under the signup rate limit (POLICY.signup =
 * 8/hour/IP; every test shares localhost as its IP).
 *
 * Done via the API (not the UI) so it is deterministic and immune to render
 * timing under load. Idempotent: a 409 (already exists) or 429 falls back to
 * login. Either path yields the session cookie captured into storage state.
 */
export const PRIMARY = {
  email: "cert.primary@seed.local",
  password: "CertPass2026x!",
  name: "Cert Primary",
};
export const STORAGE_STATE = "test/e2e/.auth/primary.json";

export default async function globalSetup() {
  const baseURL = process.env.BASE_URL ?? "http://localhost:3210";
  mkdirSync(dirname(STORAGE_STATE), { recursive: true });

  const ctx = await request.newContext({ baseURL });

  let res = await ctx.post("/api/auth/signup", {
    data: { ...PRIMARY, registryRole: "fan", ageConfirmed: true },
  });

  if (res.status() === 409 || res.status() === 429) {
    // Already registered (or signup throttled) — log in with the same creds.
    res = await ctx.post("/api/auth/login", {
      data: { email: PRIMARY.email, password: PRIMARY.password },
    });
  }

  if (!res.ok()) {
    throw new Error(`primary auth failed: ${res.status()} ${await res.text()}`);
  }

  await ctx.storageState({ path: STORAGE_STATE });
  writeFileSync("test/e2e/.auth/primary-creds.json", JSON.stringify(PRIMARY, null, 2));
  await ctx.dispose();
}
