// Create or promote a staff account — `npm run seed:admin`.
//
//   npm run seed:admin -- --email=admin1@combat.app
//   npm run seed:admin -- --email=you@example.com --password='...'
//
// With no --password a strong one is generated and printed ONCE. It is never
// written to a file and never logged again: the bcrypt hash is all that is
// stored, so if the printed value is lost the only path forward is a reset.
//
// Safe to re-run. An existing account is promoted to ADMIN rather than
// duplicated, and its password is only touched when one is supplied.
import { randomBytes } from "node:crypto";
import { prisma } from "@/lib/db";
import { hashPassword } from "@/lib/auth";

const arg = (name: string): string | undefined =>
  process.argv.find((a) => a.startsWith(`--${name}=`))?.split("=").slice(1).join("=");

const email = (arg("email") ?? "admin1@combat.app").trim().toLowerCase();
const supplied = arg("password");

/**
 * ~150 bits from a CSPRNG. Deliberately not "memorable": this is a bootstrap
 * credential meant to be pasted once into a password manager and then changed,
 * not typed from memory.
 */
function generatePassword(): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%^&*-_=+";
  const bytes = randomBytes(24);
  return Array.from(bytes, (b) => alphabet[b % alphabet.length]).join("");
}

const password = supplied ?? generatePassword();
const passwordHash = await hashPassword(password);

const existing = await prisma.user.findUnique({
  where: { email },
  select: { id: true, role: true, username: true },
});

let action: string;
if (existing) {
  await prisma.user.update({
    where: { id: existing.id },
    data: {
      role: "ADMIN",
      // Only rotate the password when one was explicitly supplied — a re-run to
      // fix a role must not silently invalidate a working login.
      ...(supplied ? { passwordHash, tokenVersion: { increment: 1 } } : {}),
    },
  });
  action = supplied ? "promoted to ADMIN and password reset" : "promoted to ADMIN (password unchanged)";
} else {
  const base = email.split("@")[0].replace(/[^a-z0-9_]/gi, "").slice(0, 20) || "admin";
  let username = base;
  for (let i = 0; await prisma.user.findUnique({ where: { username }, select: { id: true } }); i++) {
    username = `${base.slice(0, 15)}${i + 1}`;
  }
  await prisma.user.create({
    data: {
      email, username, name: "Administrator", passwordHash, role: "ADMIN",
      registryRole: "fan",
      // Staff accounts are created by an operator at a terminal, which is a
      // stronger age/terms signal than a checkbox, and leaving these null makes
      // the account look half-registered in every admin view.
      ageConfirmed: true, ageConfirmedAt: new Date(),
      emailVerified: new Date(),
      termsAcceptedAt: new Date(),
    },
  });
  action = "created as ADMIN";
}

await prisma.auditLog.create({
  data: {
    actorId: null, action: "admin.seed", entity: "User", entityId: email,
    meta: { via: "scripts/seed-admin.mts", passwordSupplied: Boolean(supplied) },
  },
});

console.log(`\n  ${email} — ${action}\n`);
if (!supplied) {
  console.log("  Password (shown once — copy it now):\n");
  console.log(`      ${password}\n`);
  console.log("  Change it after signing in: /account/security\n");
}
await prisma.$disconnect();
