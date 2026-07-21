// ════════════════════════════════════════════════════════════════════════════
//  Seed World — safety guard + mode resolution.
//
//  The Seed World generates a believable community so testers/QA/investors can
//  experience CombatReviews as if it had months of organic growth. It must NEVER
//  touch the real production database. Safety here is default-DENY:
//
//    • Manual scripts (npm run seed:demo/refresh/wipe/status) run only against a
//      LOCAL database, or an explicitly ALLOWLISTED remote demo host.
//    • Startup seeding (boot.mts) runs only when SEED_WORLD_MODE is demo|refresh
//      AND the same host gate passes.
//    • A remote host is permitted only if it is named in SEED_WORLD_DEMO_HOSTS
//      (a POSITIVE allowlist) — an unknown host, or the production host, is
//      refused. The production DB host is never in that allowlist, so it can
//      never be seeded, even if a mode env were mis-set.
//
//  Belt and braces: the prod Render service never runs boot.mts at all (its start
//  command is plain `npm start`), so seed code does not execute in prod regardless.
// ════════════════════════════════════════════════════════════════════════════

export type SeedMode = "off" | "demo" | "refresh";

export interface SeedWorldContext {
  mode: SeedMode;
  enabled: boolean;
  host: string;
  database: string;
  environment: string;
}

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1"]);

function parseDb(url: string): { host: string; database: string } {
  try {
    const u = new URL(url);
    return { host: u.hostname || "(none)", database: u.pathname.replace(/^\//, "") || "(none)" };
  } catch {
    return { host: "(unparseable)", database: "(unknown)" };
  }
}

const csv = (v: string | undefined): string[] => (v ?? "").split(",").map((s) => s.trim()).filter(Boolean);
const truthy = (v: string | undefined): boolean => v === "true" || v === "1";

function environmentName(): string {
  return process.env.APP_ENV ?? process.env.NODE_ENV ?? "development";
}

/**
 * The shared host gate — the single guarantee that the production DB can't be
 * seeded. Returns nothing; throws with every reason if the target is not safe.
 */
function assertHostSafe(host: string, database: string): void {
  const problems: string[] = [];
  const allowRemote = truthy(process.env.ALLOW_SEED_WORLD) || truthy(process.env.SEED_WORLD_ALLOW_REMOTE);
  const isLocal = LOCAL_HOSTS.has(host);

  if (!host || host === "(none)" || host === "(unparseable)") {
    problems.push("DATABASE_URL is missing or unparseable — cannot verify the target is safe.");
  } else if (!isLocal) {
    // Remote target: must be explicitly permitted AND explicitly allowlisted.
    if (!allowRemote) {
      problems.push(
        `Remote database host "${host}" but remote seeding is off. Set ALLOW_SEED_WORLD=true (or ` +
          `SEED_WORLD_ALLOW_REMOTE=true) — and only on the demo service.`,
      );
    }
    const allow = csv(process.env.SEED_WORLD_DEMO_HOSTS);
    const approved = allow.some((a) => host === a || database === a || host.includes(a));
    if (!approved) {
      problems.push(
        `Host "${host}" (db "${database}") is not in the approved demo allowlist SEED_WORLD_DEMO_HOSTS ` +
          `[${allow.join(", ") || "empty"}] — default-deny. Add the DEMO db host there, never production.`,
      );
    }
  }

  // Hard denylist — an extra tripwire for known production markers.
  const deny = csv(process.env.SEED_WORLD_PROD_HOSTS);
  if (deny.some((d) => host === d || database === d || host.includes(d))) {
    problems.push(`Target "${database}@${host}" matches a SEED_WORLD_PROD_HOSTS production marker — refusing.`);
  }

  if (problems.length) {
    throw new Error(
      "✋ Seed World refused — the production database must never receive generated data:\n" +
        problems.map((p) => `   • ${p}`).join("\n"),
    );
  }
}

/**
 * Gate for MANUAL scripts (seed:demo / refresh / wipe / status). Host safety only
 * — running the command IS the intent, so it does not require SEED_WORLD_MODE.
 * Still refuses production: NODE_ENV=production needs an explicit remote opt-in.
 */
export function assertManualSeedAllowed(): SeedWorldContext {
  const { host, database } = parseDb(process.env.DATABASE_URL ?? "");
  if (process.env.NODE_ENV === "production" && !(truthy(process.env.ALLOW_SEED_WORLD) || truthy(process.env.SEED_WORLD_ALLOW_REMOTE))) {
    throw new Error("✋ Seed World refused — NODE_ENV=production without an explicit remote opt-in (ALLOW_SEED_WORLD=true).");
  }
  assertHostSafe(host, database);
  return { mode: "demo", enabled: true, host, database, environment: environmentName() };
}

/**
 * Resolve the STARTUP seed mode from the environment and enforce every gate.
 * Throws (→ non-zero exit → the service refuses to start LOUDLY) on any unsafe
 * or contradictory configuration. Returns a disabled context for mode=off.
 */
export function resolveSeedWorld(): SeedWorldContext {
  // DEMO_MODE=true is the simple alias: it means SEED_WORLD_MODE=demo unless the
  // more specific SEED_WORLD_MODE is set explicitly.
  const demoFlag = truthy(process.env.DEMO_MODE);
  const raw = (process.env.SEED_WORLD_MODE ?? (demoFlag ? "demo" : "off")).toLowerCase();
  const mode: SeedMode = raw === "demo" || raw === "refresh" ? raw : "off";
  const { host, database } = parseDb(process.env.DATABASE_URL ?? "");
  const environment = environmentName();

  if (mode === "off") return { mode: "off", enabled: false, host, database, environment };

  const allowRemote = truthy(process.env.ALLOW_SEED_WORLD) || truthy(process.env.SEED_WORLD_ALLOW_REMOTE);
  if (process.env.NODE_ENV === "production" && !allowRemote) {
    throw new Error(
      `✋ SEED_WORLD_MODE=${mode} with NODE_ENV=production but ALLOW_SEED_WORLD/SEED_WORLD_ALLOW_REMOTE != true — refusing to start.`,
    );
  }
  assertHostSafe(host, database);
  return { mode, enabled: true, host, database, environment };
}

/** The startup banner — always printed so the mode is unmistakable in logs. */
export function seedBanner(ctx: SeedWorldContext): string {
  return [
    "=== CombatReviews Seed World ===",
    `Mode: ${ctx.mode}`,
    `Environment: ${ctx.environment}`,
    `Database: ${ctx.database}@${ctx.host}`,
    `Status: ${ctx.enabled ? "ENABLED" : "DISABLED"}`,
    "================================",
  ].join("\n");
}
