// ════════════════════════════════════════════════════════════════════════════
//  Seed World — mode resolution.
//
//  SINGLE SOURCE OF TRUTH: SEED_WORLD_MODE.
//    off | (unset)  → never seed; leave any existing seed data untouched.
//    demo           → seed once on startup if not already seeded (idempotent).
//    refresh        → wipe + regenerate once per deploy, then behave as demo.
//
//  No other feature flags, no host allowlist — it operates on whatever DATABASE_URL
//  points at (so it works on Render). Seed rows are marked (users carry an
//  @seed.local email; everything else is owned by a seed user and cascades), so the
//  reset endpoint can remove them cleanly without ever touching real accounts.
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

/** Resolve the seed mode from the single SEED_WORLD_MODE flag. Never throws. */
export function resolveSeedWorld(): SeedWorldContext {
  const raw = (process.env.SEED_WORLD_MODE ?? "off").toLowerCase();
  const mode: SeedMode = raw === "demo" || raw === "refresh" ? raw : "off";
  const { host, database } = parseDb(process.env.DATABASE_URL ?? "");
  return { mode, enabled: mode !== "off", host, database, environment: environmentName() };
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
    `Status: ${ctx.enabled ? "ENABLED" : "DISABLED"}`,
    "================================",
  ].join("\n");
}
