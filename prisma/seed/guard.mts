// ════════════════════════════════════════════════════════════════════════════
//  Seed World — mode resolution.
//
//  MASTER SWITCH: ALLOW_SEED_WORLD.
//    true            → demo data is PERMITTED to exist in this database.
//    anything else   → demo data is PURGED from this database at every boot.
//
//  There is deliberately no way to have simulated people in the database without
//  ALLOW_SEED_WORLD=true. "Off" does not mean "stop adding" — it means "there are
//  none", enforced by deletion rather than by filtering at read time. Filtering
//  would leave fake accounts one missed WHERE clause away from a real user, and a
//  launch is exactly when that clause gets missed.
//
//  SEED_WORLD_MODE only refines HOW to seed once seeding is allowed:
//    demo (default)  → seed once if the DB has no seed users; else skip.
//    refresh         → wipe + regenerate once per deploy, then behave as demo.
//  It cannot enable seeding on its own.
//
//  No host allowlist — it operates on whatever DATABASE_URL points at (so it
//  works on Render). Seed rows are marked (users carry an @seed.local email;
//  everything else is owned by a seed user and cascades), so cleanup is exact and
//  never touches a real account.
// ════════════════════════════════════════════════════════════════════════════

export type SeedMode = "off" | "demo" | "refresh";

export interface SeedWorldContext {
  mode: SeedMode;
  enabled: boolean;
  host: string;
  database: string;
  environment: string;
}

function parseDb(url: string): { host: string; database: string } {
  try {
    const u = new URL(url);
    return { host: u.hostname || "(none)", database: u.pathname.replace(/^\//, "") || "(none)" };
  } catch {
    return { host: "(unparseable)", database: "(unknown)" };
  }
}

function environmentName(): string {
  return process.env.APP_ENV ?? process.env.NODE_ENV ?? "development";
}

/** True only for an explicit, unambiguous opt-in. Anything else means purge. */
export function seedWorldAllowed(env: NodeJS.ProcessEnv = process.env): boolean {
  return (env.ALLOW_SEED_WORLD ?? "").trim().toLowerCase() === "true";
}

/**
 * Resolve the seed context. ALLOW_SEED_WORLD decides whether demo data may exist
 * at all; SEED_WORLD_MODE only chooses how to seed when it may. Never throws.
 */
export function resolveSeedWorld(env: NodeJS.ProcessEnv = process.env): SeedWorldContext {
  const allowed = seedWorldAllowed(env);
  const raw = (env.SEED_WORLD_MODE ?? "demo").toLowerCase();
  // Not allowed ⇒ "off", regardless of SEED_WORLD_MODE. One switch, no back door.
  const mode: SeedMode = !allowed ? "off" : raw === "refresh" ? "refresh" : "demo";
  const { host, database } = parseDb(env.DATABASE_URL ?? "");
  return { mode, enabled: allowed, host, database, environment: environmentName() };
}

/**
 * Context for MANUAL scripts (seed:demo / wipe / status). Running the command is
 * the intent, so it works regardless of SEED_WORLD_MODE and against the configured
 * DATABASE_URL. Cleanup safety comes from the @seed.local marker + cascade, not a
 * host gate.
 */
export function manualContext(): SeedWorldContext {
  const { host, database } = parseDb(process.env.DATABASE_URL ?? "");
  return { mode: "demo", enabled: true, host, database, environment: environmentName() };
}

/** The startup/CLI banner — always printed so the mode is unmistakable in logs. */
export function seedBanner(ctx: SeedWorldContext): string {
  return [
    "=== CombatReviews Seed World ===",
    `Mode: ${ctx.mode}`,
    `Environment: ${ctx.environment}`,
    `Database: ${ctx.database}@${ctx.host}`,
    `Status: ${ctx.enabled ? "ALLOWED (demo data may exist)" : "NOT ALLOWED (demo data is purged)"}`,
    "================================",
  ].join("\n");
}
