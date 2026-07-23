// Integration-test helpers. These run the REAL server modules against a
// disposable Postgres (see docs/HARDENING.md / package.json test:integration).
// Requires: node --conditions=react-server (so `import "server-only"` no-ops)
// and DATABASE_URL pointing at a migrated throwaway DB.
import { prisma } from "@/lib/db";

/** Truncate every table (except the migration ledger) so each test is isolated. */
export async function resetDb(): Promise<void> {
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
