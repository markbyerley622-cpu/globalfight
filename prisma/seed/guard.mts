// ════════════════════════════════════════════════════════════════════════════
//  Seed World — safety guard.
//
//  The Development Seed World generates a believable combat-sports community so we
//  can experience the product as it would feel after months of organic growth. It
//  must NEVER touch a production database. This guard is the hard gate: three
//  independent checks, all of which must pass before a single row is written.
//
//    1. NODE_ENV must not be "production".
//    2. Explicit intent — invoked via the sanctioned npm script, or SEED_DEMO=1.
//    3. The DATABASE_URL host must be local (localhost/127.0.0.1/::1). A non-local
//       host is refused outright; only an explicit SEED_ALLOW_HOST=<host> opt-in
//       (for a KNOWN staging DB) can permit one — never production.
//
//  Defence in depth: even if NODE_ENV were mis-set, the local-host check alone
//  stops a run against the Render production database (a remote host).
// ════════════════════════════════════════════════════════════════════════════

export interface SeedContext {
  host: string;
  database: string;
}

function hostOf(databaseUrl: string): { host: string; database: string } {
  try {
    const u = new URL(databaseUrl);
    return { host: u.hostname || "(none)", database: u.pathname.replace(/^\//, "") || "(none)" };
  } catch {
    return { host: "(unparseable)", database: "(unknown)" };
  }
}

export function assertSeedAllowed(): SeedContext {
  const problems: string[] = [];

  if (process.env.NODE_ENV === "production") {
    problems.push("NODE_ENV is 'production' — the seed world is dev/staging/demo only.");
  }

  const invokedViaScript =
    process.env.npm_lifecycle_event === "seed:demo" || process.env.npm_lifecycle_event === "seed:wipe";
  if (!invokedViaScript && process.env.SEED_DEMO !== "1") {
    problems.push("No explicit intent — run `npm run seed:demo` or set SEED_DEMO=1.");
  }

  const url = process.env.DATABASE_URL ?? "";
  if (!url) problems.push("DATABASE_URL is not set (did the env file load?).");
  const { host, database } = hostOf(url);

  const local = new Set(["localhost", "127.0.0.1", "::1"]);
  const override = process.env.SEED_ALLOW_HOST?.trim();
  if (url && !local.has(host) && host !== override) {
    problems.push(
      `DATABASE_URL host "${host}" is not local. Refusing to write demo data to a remote database. ` +
        `If this is a KNOWN non-production DB, re-run with SEED_ALLOW_HOST=${host}.`,
    );
  }

  if (problems.length) {
    throw new Error(
      "✋ Seed World refused to run — the production database must never receive generated data:\n" +
        problems.map((p) => `   • ${p}`).join("\n"),
    );
  }

  return { host, database };
}
