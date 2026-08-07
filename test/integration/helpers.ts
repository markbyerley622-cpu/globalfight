// Integration-test helpers. These run the REAL server modules against a
// disposable Postgres (see docs/HARDENING.md / package.json test:integration).
// Requires: node --conditions=react-server (so `import "server-only"` no-ops)
// and DATABASE_URL pointing at a migrated throwaway DB.
import { prisma } from "@/lib/db";

/**
 * Databases `resetDb` is allowed to TRUNCATE. Anything else is refused.
 *
 * ── Why this guard exists ────────────────────────────────────────────────
 * It did not, and on 2026-08-07 `npm run test:integration` truncated the DEV
 * database: ~9,000 fighters, 13,915 fights and ~500 ONE Championship events,
 * all of it crawl output.
 *
 * The mechanism is worth stating exactly, because nothing in the command looks
 * dangerous. `test:integration` passes no `--env-file`, and `.env.test.local`
 * — which exists and names `combat_gf_test` — was referenced by NOTHING in the
 * repo. Prisma then auto-loads `.env` from the project root all by itself, so
 * DATABASE_URL silently resolved to the dev database and resetDb truncated it,
 * table by table, before the first test even ran. Every test still passed.
 *
 * The npm script now names the env file explicitly, which fixes the default.
 * This check is the part that has to be here anyway: an env file can be
 * missing, stale, or overridden by an ambient DATABASE_URL, and the cost of
 * being wrong is the whole dataset. A test suite may destroy a test database
 * and nothing else.
 */
const TRUNCATABLE = /(^|_)test$/;

/** Whether `resetDb` may destroy this database. Exported so it is unit-tested without one. */
export const isTruncatableDb = (name: string): boolean => TRUNCATABLE.test(name.trim());

/** Truncate every table (except the migration ledger) so each test is isolated. */
export async function resetDb(): Promise<void> {
  const [{ db }] = await prisma.$queryRaw<{ db: string }[]>`SELECT current_database() AS db`;
  if (!isTruncatableDb(db)) {
    throw new Error(
      `resetDb refused to TRUNCATE "${db}": integration tests may only run against a database ` +
        `whose name ends in "_test" (or is named "test"). Point DATABASE_URL at your test database — ` +
        `see .env.test.local — and re-run. NOTHING WAS DELETED.`,
    );
  }
  const rows = await prisma.$queryRaw<{ tablename: string }[]>`
    SELECT tablename FROM pg_tables
    WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`;
  const list = rows.map((r) => `"${r.tablename}"`).join(",");
  if (list) await prisma.$executeRawUnsafe(`TRUNCATE TABLE ${list} RESTART IDENTITY CASCADE`);
}

let seq = 0;
const uniq = (p: string) => `${p}-${Date.now().toString(36)}-${seq++}`;

export async function makeUser() {
  return prisma.user.create({ data: { username: uniq("u"), email: `${uniq("e")}@t.test` } });
}

export async function makeFighter(name: string) {
  return prisma.fighter.create({ data: { slug: uniq(name.toLowerCase()), name, sport: "MMA" } });
}

/** A scheduled MMA bout between two fresh fighters on a fresh event. */
export async function makeFight() {
  const [red, blue] = await Promise.all([makeFighter("Red"), makeFighter("Blue")]);
  const event = await prisma.event.create({
    data: { slug: uniq("evt"), name: "Test Card", sport: "MMA", date: new Date(), status: "SCHEDULED" },
  });
  const fight = await prisma.fight.create({
    data: { slug: uniq("fight"), eventId: event.id, redId: red.id, blueId: blue.id, date: new Date() },
  });
  return { red, blue, event, fight };
}

export async function pick(userId: string, fightId: string, corner: "RED" | "BLUE", confidence = 3) {
  return prisma.fightPick.create({ data: { userId, fightId, corner, confidence } });
}
