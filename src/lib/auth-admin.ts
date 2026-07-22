// ════════════════════════════════════════════════════════════════════════
//  Admin bootstrap — explicit, one-time, never automatic.
//
//  History: this module hardcoded a fixed admin address and password, and
//  provisioned that account on EVERY server boot. The repository is public, so
//  every deploy re-created a working administrator login whose password anyone
//  could read.
//
//  The application now NEVER creates or modifies an admin account during startup,
//  request handling, health checks, or seeding. There is exactly one way to make
//  an administrator:
//
//      npm run admin:bootstrap
//
//  Rules enforced here:
//    • credentials come only from BOOTSTRAP_ADMIN_EMAIL / BOOTSTRAP_ADMIN_PASSWORD
//    • no defaults, no placeholders, no weak passwords
//    • in production it additionally requires ALLOW_ADMIN_BOOTSTRAP=true
//    • it creates an admin ONLY when no account exists for that email
//    • it NEVER resets or overwrites an existing account's password
//    • promoting an existing non-admin account requires an explicit --promote flag
//      (deliberate, documented, tested — never silent)
//    • it is safe to run repeatedly; a second run is a no-op
// ════════════════════════════════════════════════════════════════════════

import "server-only";
import { prisma } from "@/lib/db";
import { hashPassword } from "@/lib/auth";
import { checkPassword } from "@/lib/password-policy";

export class AdminBootstrapError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AdminBootstrapError";
  }
}

export interface AdminBootstrapConfig {
  email: string;
  password: string;
}

/**
 * Credentials that are structurally strong enough to pass the password policy but
 * are obviously defaults. An operator who pastes one of these has not chosen a
 * password, and we must not mint an administrator with it.
 */
// Matched as substrings, so "change-me-please-1234" is caught as well as "change-me".
//
// Deliberately does NOT include bare "password" or "admin": those appear in plenty
// of legitimate passphrases ("a-genuinely-chosen-password-7f2b"), and rejecting them
// would push operators toward something shorter and worse. Genuinely common
// passwords are already caught by checkPassword(); this list is specifically for
// values that mean "the operator did not choose a password".
const DEFAULT_LOOKING = [
  "change-me", "changeme", "change_me",
  "letmein", "administrator", "adminadmin", "password123",
  "combatregister", "combat-register",
  "bootstrap", "placeholder", "example", "dummy", "sample",
  "reviews1234", // the credential this repository published
];

function looksDefault(password: string): boolean {
  const lowered = password.toLowerCase();
  return DEFAULT_LOOKING.some((d) => lowered.includes(d));
}

/**
 * Read and validate bootstrap credentials.
 *
 * @throws AdminBootstrapError on missing, weak, placeholder or default-looking
 *         input, and in production when ALLOW_ADMIN_BOOTSTRAP !== "true".
 *         Error text NEVER contains the password.
 */
export function readBootstrapConfig(env: NodeJS.ProcessEnv = process.env): AdminBootstrapConfig {
  // Production requires a second, deliberate opt-in. Setting the credentials alone
  // is not enough — an operator must say "yes, provision an admin on this deploy".
  if (env.NODE_ENV === "production" && env.ALLOW_ADMIN_BOOTSTRAP !== "true") {
    throw new AdminBootstrapError(
      "Refusing to bootstrap an admin in production without ALLOW_ADMIN_BOOTSTRAP=true. " +
        "Set it for the single run, then remove it (and the BOOTSTRAP_ADMIN_* variables) again.",
    );
  }

  const email = env.BOOTSTRAP_ADMIN_EMAIL?.trim().toLowerCase();
  const password = env.BOOTSTRAP_ADMIN_PASSWORD;

  if (!email || !password) {
    throw new AdminBootstrapError(
      "BOOTSTRAP_ADMIN_EMAIL and BOOTSTRAP_ADMIN_PASSWORD must both be set. " +
        "There is no default administrator credential.",
    );
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new AdminBootstrapError("BOOTSTRAP_ADMIN_EMAIL is not a valid email address.");
  }

  const weak = checkPassword(password);
  if (weak) throw new AdminBootstrapError(`BOOTSTRAP_ADMIN_PASSWORD is not strong enough: ${weak}`);

  if (looksDefault(password)) {
    throw new AdminBootstrapError(
      "BOOTSTRAP_ADMIN_PASSWORD looks like a default or placeholder. Choose a real, unique password.",
    );
  }

  return { email, password };
}

export type BootstrapOutcome =
  | "created"            // no account existed; admin provisioned
  | "already-admin"      // idempotent no-op
  | "promoted"           // existing account granted ADMIN — only with explicit opt-in
  | "exists-not-admin";  // existing non-admin account; refused (no silent promotion)

export interface BootstrapOptions {
  /**
   * Explicitly promote an existing non-admin account to ADMIN.
   *
   * OFF by default and never implied. Silent promotion is a privilege-escalation
   * path: an attacker who can register `ops@yourcompany.com` before you bootstrap
   * would otherwise be handed ADMIN by your own deploy. The password of a promoted
   * account is never touched — only the role changes.
   */
  promoteExisting?: boolean;
}

/**
 * Provision the initial administrator.
 *
 * Idempotent. Never overwrites an existing password under any circumstances.
 */
export async function bootstrapAdmin(
  config: AdminBootstrapConfig,
  options: BootstrapOptions = {},
): Promise<BootstrapOutcome> {
  const existing = await prisma.user.findUnique({
    where: { email: config.email },
    select: { id: true, role: true },
  });

  if (existing?.role === "ADMIN") return "already-admin";

  if (existing) {
    if (!options.promoteExisting) return "exists-not-admin";

    // Role only. The password stays exactly as the account owner set it.
    await prisma.user.update({ where: { id: existing.id }, data: { role: "ADMIN" } });
    await prisma.auditLog.create({
      data: { actorId: null, action: "admin.bootstrap.promote", entity: "User", entityId: existing.id },
    });
    return "promoted";
  }

  const passwordHash = await hashPassword(config.password);
  const created = await prisma.user.create({
    data: {
      email: config.email,
      name: "Combat Reviews Admin",
      username: await freeUsername("admin"),
      passwordHash,
      role: "ADMIN",
      registryRole: "fan",
    },
    select: { id: true },
  });
  await prisma.auditLog.create({
    data: { actorId: null, action: "admin.bootstrap.create", entity: "User", entityId: created.id },
  });
  return "created";
}

async function freeUsername(base: string): Promise<string> {
  if (!(await prisma.user.findUnique({ where: { username: base }, select: { id: true } }))) return base;
  for (let i = 2; i < 100; i++) {
    const candidate = `${base}${i}`;
    if (!(await prisma.user.findUnique({ where: { username: candidate }, select: { id: true } }))) return candidate;
  }
  throw new AdminBootstrapError("Could not allocate an admin username.");
}
