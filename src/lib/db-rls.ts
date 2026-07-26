import "server-only";
import { prisma } from "@/lib/db";
import type { Prisma } from "@prisma/client";

// ── RLS session context (the enabler for prisma/rls/policies.sql) ───────────
//
// The policies key on `current_setting('app.user_id')`. Nothing sets that today,
// which is exactly why RLS is not yet switched on: with FORCE enabled and no
// user id set, every owner policy matches zero rows and all private reads go
// empty. This wraps a unit of work in a transaction that sets the id FIRST, so
// every query inside sees the right user.
//
// GATED: does nothing unless RLS_SESSION_CONTEXT=1. Until the staged rollout in
// docs/SECURITY-RLS.md is done (non-owner DB role + policies applied in staging),
// the app connects as the table owner and RLS is bypassed anyway — so this is
// inert by default and safe to ship ahead of activation.
//
// Uses set_config($1, $2, true) with BOUND parameters — never string
// interpolation into SQL. The `true` makes it LOCAL to the transaction, so the
// setting is scoped to this request and cannot leak to the next one on a pooled
// connection.

const ENABLED = process.env.RLS_SESSION_CONTEXT === "1";

/**
 * Run `fn` with the request's user id bound as `app.user_id` for the length of a
 * transaction. When RLS is not yet active this passes the shared client straight
 * through, so callers can adopt it now and it becomes enforcing only once the
 * flag and policies are in place.
 */
export async function withUser<T>(
  userId: string,
  fn: (tx: Prisma.TransactionClient) => Promise<T>,
): Promise<T> {
  if (!ENABLED) {
    // Inert: behave as a normal query against the shared client.
    return fn(prisma as unknown as Prisma.TransactionClient);
  }
  return prisma.$transaction(async (tx) => {
    // Parameterised — the id never touches the SQL string.
    await tx.$executeRaw`SELECT set_config('app.user_id', ${userId}, true)`;
    return fn(tx);
  });
}

/** Anonymous unit of work: no user id set, so owner policies match nothing. */
export async function withoutUser<T>(
  fn: (tx: Prisma.TransactionClient) => Promise<T>,
): Promise<T> {
  if (!ENABLED) return fn(prisma as unknown as Prisma.TransactionClient);
  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.user_id', '', true)`;
    return fn(tx);
  });
}

export const rlsSessionContextEnabled = ENABLED;
