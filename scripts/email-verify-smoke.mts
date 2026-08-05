// Live smoke test for the email-verification flow — `npm run verify:smoke`.
//
// The unit tests cover hashing and code generation; everything that MATTERS
// here is transactional (supersede-on-reissue, the attempt counter, the cascade)
// and only a real database can prove it. Creates throwaway users, exercises
// every branch, deletes them.
//
// Refuses to run against anything but a local database, because it writes User
// rows. A smoke test that can create accounts in production is not a smoke test,
// it is an incident waiting for a mistyped env file.
import { prisma } from "@/lib/db";
import {
  issueVerificationCode, redeemVerificationCode, isEmailVerified,
  MAX_ATTEMPTS, RESEND_COOLDOWN_SECONDS,
} from "@/lib/auth-email-verify";

const url = process.env.DATABASE_URL ?? "";
const host = (() => { try { return new URL(url).hostname; } catch { return ""; } })();
if (!["localhost", "127.0.0.1", "::1"].includes(host)) {
  console.error(`Refusing to run: DATABASE_URL points at "${host || "(unparseable)"}", not a local database.`);
  process.exit(2);
}

const EMAIL = `_smoke_verify_${Date.now()}@example.test`;
let pass = 0, fail = 0;
const check = (name: string, ok: boolean, extra = "") => {
  if (ok) { pass++; console.log(`  PASS  ${name}`); }
  else { fail++; console.log(`  FAIL  ${name} ${extra}`); }
};

const user = await prisma.user.create({
  data: { email: EMAIL, name: "Smoke Verify", username: `smokeverify${Date.now()}`, passwordHash: "x" },
  select: { id: true },
});
console.log(`user ${user.id}\n`);

try {
  // ── 1. issue ──────────────────────────────────────────────────────────────
  const first = await issueVerificationCode(user.id, "127.0.0.1");
  check("issues a code", first.ok);
  if (!first.ok) throw new Error("cannot continue");
  check("code is 6 digits", /^\d{6}$/.test(first.code), first.code);
  const row0 = await prisma.emailVerificationToken.findFirst({ where: { userId: user.id } });
  check("code is NOT stored in plaintext", !JSON.stringify(row0).includes(first.code));

  // ── 2. resend cooldown ────────────────────────────────────────────────────
  const second = await issueVerificationCode(user.id, "127.0.0.1");
  check("second send inside cooldown is refused", !second.ok && second.reason === "COOLDOWN");
  check("cooldown reports a retryAfter", !second.ok && typeof second.retryAfter === "number"
    && second.retryAfter! > 0 && second.retryAfter! <= RESEND_COOLDOWN_SECONDS);

  // ── 3. wrong code burns attempts ──────────────────────────────────────────
  const wrong = first.code === "000000" ? "111111" : "000000";
  const w1 = await redeemVerificationCode(user.id, wrong);
  check("wrong code rejected", !w1.ok && w1.reason === "INVALID");
  check("reports attempts remaining", !w1.ok && w1.attemptsLeft === MAX_ATTEMPTS - 1, String(!w1.ok && w1.attemptsLeft));
  check("not verified after a wrong guess", !(await isEmailVerified(user.id)));

  // ── 4. malformed input never touches the DB ───────────────────────────────
  const before = (await prisma.emailVerificationToken.findFirst({ where: { userId: user.id }, select: { attempts: true } }))!.attempts;
  await redeemVerificationCode(user.id, "abc");
  await redeemVerificationCode(user.id, "12345");
  const after = (await prisma.emailVerificationToken.findFirst({ where: { userId: user.id }, select: { attempts: true } }))!.attempts;
  check("malformed codes do not consume attempts", before === after, `${before} -> ${after}`);

  // ── 5. correct code verifies ──────────────────────────────────────────────
  const good = await redeemVerificationCode(user.id, first.code);
  check("correct code accepted", good.ok, JSON.stringify(good));
  check("User.emailVerified is set", await isEmailVerified(user.id));
  const used = await prisma.emailVerificationToken.findFirst({ where: { userId: user.id }, select: { usedAt: true } });
  check("token marked used", used?.usedAt !== null);

  // ── 6. idempotency + post-verification behaviour ──────────────────────────
  const again = await redeemVerificationCode(user.id, first.code);
  check("re-submitting after success is idempotent, not an error", again.ok);
  const reissue = await issueVerificationCode(user.id, null);
  check("already-verified account will not issue a new code",
    !reissue.ok && reissue.reason === "ALREADY_VERIFIED");

  // ── 7. attempt cap burns the token ────────────────────────────────────────
  const u2 = await prisma.user.create({
    data: { email: `_smoke2_${Date.now()}@example.test`, name: "Smoke Two", username: `smoketwo${Date.now()}`, passwordHash: "x" },
    select: { id: true },
  });
  const t2 = await issueVerificationCode(u2.id, null);
  if (t2.ok) {
    const bad = t2.code === "000000" ? "111111" : "000000";
    let last;
    for (let i = 0; i < MAX_ATTEMPTS; i++) last = await redeemVerificationCode(u2.id, bad);
    check(`token dies after ${MAX_ATTEMPTS} wrong attempts`,
      !last!.ok && last!.reason === "TOO_MANY_ATTEMPTS", JSON.stringify(last));
    const nowCorrect = await redeemVerificationCode(u2.id, t2.code);
    check("the CORRECT code no longer works on a burned token",
      !nowCorrect.ok && nowCorrect.reason === "TOO_MANY_ATTEMPTS", JSON.stringify(nowCorrect));
  }
  await prisma.user.delete({ where: { id: u2.id } });

  // ── 8. email change invalidates an outstanding code ───────────────────────
  const u3 = await prisma.user.create({
    data: { email: `_smoke3_${Date.now()}@example.test`, name: "Smoke Three", username: `smokethree${Date.now()}`, passwordHash: "x" },
    select: { id: true },
  });
  const t3 = await issueVerificationCode(u3.id, null);
  await prisma.user.update({ where: { id: u3.id }, data: { email: `_changed_${Date.now()}@example.test` } });
  if (t3.ok) {
    const stale = await redeemVerificationCode(u3.id, t3.code);
    check("a code is void once the address it was sent to changes",
      !stale.ok && stale.reason === "EMAIL_CHANGED", JSON.stringify(stale));
  }
  await prisma.user.delete({ where: { id: u3.id } });

  // ── 9. cascade ────────────────────────────────────────────────────────────
  await prisma.user.delete({ where: { id: user.id } });
  const orphans = await prisma.emailVerificationToken.count({ where: { userId: user.id } });
  check("tokens cascade-delete with the user", orphans === 0, String(orphans));
} finally {
  await prisma.user.deleteMany({ where: { email: { startsWith: "_smoke" } } });
  await prisma.$disconnect();
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
