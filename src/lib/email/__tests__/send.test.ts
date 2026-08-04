import { test } from "node:test";
import assert from "node:assert/strict";
import { isEmailConfigured, sendEmail, EmailNotConfiguredError } from "../send";

// Password reset depends entirely on isEmailConfigured() agreeing with what
// sendEmail() will actually do — a launch-readiness check or the reset route
// itself trusting a stale/duplicated copy of this logic is exactly the bug
// class that made password reset look configured while still 503ing.

const EMAIL_VARS = ["EMAIL_PROVIDER", "RESEND_API_KEY", "EMAIL_FROM", "SMTP_HOST", "SMTP_PORT", "SMTP_USER", "SMTP_PASS", "NODE_ENV"] as const;

/** Every test body runs inside this — sync or async — with a clean, fully
 *  isolated set of email env vars, restored afterward regardless of outcome
 *  (including when the body throws/rejects, which several tests expect). */
// NODE_ENV is typed read-only (Next.js's ProcessEnv augmentation) even though
// it's a perfectly normal mutable env var at runtime — this cast is the
// deliberate, narrow escape hatch for a test helper that needs to set it, not
// a way around a real type error.
const env = process.env as Record<string, string | undefined>;

async function withEnv<T>(vars: Partial<Record<(typeof EMAIL_VARS)[number], string>>, fn: () => T | Promise<T>): Promise<T> {
  const saved = Object.fromEntries(EMAIL_VARS.map((k) => [k, env[k]]));
  for (const k of EMAIL_VARS) delete env[k];
  Object.assign(env, vars);
  try {
    return await fn();
  } finally {
    for (const k of EMAIL_VARS) {
      if (saved[k] === undefined) delete env[k];
      else env[k] = saved[k];
    }
  }
}

test("isEmailConfigured: false with nothing set", async () => {
  await withEnv({}, () => assert.equal(isEmailConfigured(), false));
});

test("isEmailConfigured: false for resend missing any of the three", async () => {
  await withEnv({ EMAIL_PROVIDER: "resend", RESEND_API_KEY: "re_test" }, () => assert.equal(isEmailConfigured(), false));
  await withEnv({ EMAIL_PROVIDER: "resend", EMAIL_FROM: "a@b.com" }, () => assert.equal(isEmailConfigured(), false));
});

test("isEmailConfigured: true for resend with all three", async () => {
  await withEnv({ EMAIL_PROVIDER: "resend", RESEND_API_KEY: "re_test", EMAIL_FROM: "no-reply@example.com" }, () =>
    assert.equal(isEmailConfigured(), true));
});

test("isEmailConfigured: false for smtp missing any required var", async () => {
  await withEnv({ EMAIL_PROVIDER: "smtp", SMTP_HOST: "smtp.gmail.com", SMTP_PORT: "465", SMTP_USER: "a@gmail.com" }, () =>
    assert.equal(isEmailConfigured(), false)); // missing SMTP_PASS
});

test("isEmailConfigured: true for smtp with all required vars", async () => {
  await withEnv(
    { EMAIL_PROVIDER: "smtp", SMTP_HOST: "smtp.gmail.com", SMTP_PORT: "465", SMTP_USER: "a@gmail.com", SMTP_PASS: "app-password", EMAIL_FROM: "a@gmail.com" },
    () => assert.equal(isEmailConfigured(), true),
  );
});

test("isEmailConfigured: an unrecognised EMAIL_PROVIDER is not configured", async () => {
  await withEnv({ EMAIL_PROVIDER: "mailgun", RESEND_API_KEY: "x", EMAIL_FROM: "a@b.com" }, () => assert.equal(isEmailConfigured(), false));
});

test("sendEmail throws EmailNotConfiguredError in production with nothing set", async () => {
  await withEnv({ NODE_ENV: "production" }, () =>
    assert.rejects(() => sendEmail({ to: "a@b.com", subject: "s", text: "t" }), EmailNotConfiguredError));
});

test("sendEmail does not throw outside production with nothing set (dev log fallback)", async () => {
  await withEnv({ NODE_ENV: "test" }, () =>
    assert.doesNotReject(() => sendEmail({ to: "a@b.com", subject: "s", text: "t" })));
});
