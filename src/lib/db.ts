// Prisma client singleton — prevents exhausting the connection pool during
// Next.js dev hot-reload. Import this anywhere you need typed DB access once
// USE_MOCK_DATA is flipped to "false".
import { PrismaClient } from "@prisma/client";

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === "development" ? ["warn", "error"] : ["error"],
  });

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;

// Real data (Postgres) is the default. Opt into fixtures explicitly with
// USE_MOCK_DATA="true" for offline/local work. `repo.ts` still falls back to
// fixtures if a live read fails or a table is empty, so the site never renders
// blank pre-seed.
export const USE_MOCK_DATA = process.env.USE_MOCK_DATA === "true";
