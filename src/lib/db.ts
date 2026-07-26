// Prisma client singleton — prevents exhausting the connection pool during
// Next.js dev hot-reload. Import this anywhere you need typed DB access once
// USE_MOCK_DATA is flipped to "false".
import { PrismaClient, Prisma } from "@prisma/client";

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

// Slow-query observability. In production we emit query events and log only the
// ones over SLOW_QUERY_MS (default 500ms) — answering "which DB query is slow?"
// in prod without a per-query log firehose or any new dependency. We log the
// parameterised SQL and duration ONLY, never `e.params`, so no user data leaks.
const SLOW_QUERY_MS = Number(process.env.SLOW_QUERY_MS ?? "500");

function createClient(): PrismaClient {
  if (process.env.NODE_ENV !== "production") {
    return new PrismaClient({ log: ["warn", "error"] });
  }
  const client = new PrismaClient({
    log: [
      { emit: "event", level: "query" },
      { emit: "stdout", level: "error" },
    ],
  });
  client.$on("query", (e: Prisma.QueryEvent) => {
    if (e.duration >= SLOW_QUERY_MS) {
      // Structured line; scrapeable by the log pipeline for a slow-query panel.
      console.warn(JSON.stringify({ level: "warn", ts: new Date().toISOString(), msg: "slow-query", durationMs: e.duration, query: e.query }));
    }
  });
  return client;
}

export const prisma = globalForPrisma.prisma ?? createClient();

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;

// Real data (Postgres) is the default. Opt into fixtures explicitly with
// USE_MOCK_DATA="true" for offline/local work. `repo.ts` still falls back to
// fixtures if a live read fails or a table is empty, so the site never renders
// blank pre-seed.
export const USE_MOCK_DATA = process.env.USE_MOCK_DATA === "true";
