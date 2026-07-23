import { test, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "@/lib/db";
import { hashPassword, verifyPassword, signSession, revokeAllSessions } from "@/lib/auth";
import { resetDb } from "./helpers";

// Auth high-risk paths against a real DB: password hashing, the signup→login
// credential flow, session issuance, and session revocation via tokenVersion.

beforeEach(async () => { await resetDb(); });
after(async () => { await prisma.$disconnect(); });

test("password hash verifies for the right password and rejects the wrong one", async () => {
  const hash = await hashPassword("correct-horse-battery");
  assert.notEqual(hash, "correct-horse-battery", "must not store plaintext");
  assert.equal(await verifyPassword("correct-horse-battery", hash), true);
  assert.equal(await verifyPassword("wrong", hash), false);
});

test("signup→login credential flow works end-to-end", async () => {
  const passwordHash = await hashPassword("s3cret-pass");
  const user = await prisma.user.create({
    data: { username: "loginflow", email: "login@t.test", passwordHash },
  });

  // Login: look the user up by email and verify the supplied password.
  const found = await prisma.user.findUnique({ where: { email: "login@t.test" } });
  assert.ok(found?.passwordHash);
  assert.equal(await verifyPassword("s3cret-pass", found!.passwordHash!), true);
  assert.equal(await verifyPassword("nope", found!.passwordHash!), false);
  assert.equal(found!.id, user.id);
});

test("signSession issues a token bound to the user id", async () => {
  const token = await signSession("user-123", 0);
  assert.ok(token.split(".").length === 3, "a JWT has three segments");
  const payload = JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString());
  assert.equal(payload.sub, "user-123");
  assert.equal(payload.tv, 0);
});

test("revokeAllSessions bumps tokenVersion (invalidates old tokens)", async () => {
  const user = await prisma.user.create({ data: { username: "revoke", email: "revoke@t.test" } });
  assert.equal(user.tokenVersion, 0);
  await revokeAllSessions(user.id);
  const after = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
  assert.ok(after.tokenVersion > 0, "tokenVersion must increase so prior sessions fail verification");
});
