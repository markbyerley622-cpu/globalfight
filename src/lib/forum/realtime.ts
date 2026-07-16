// ════════════════════════════════════════════════════════════════════════
//  Forum realtime — PostgreSQL LISTEN/NOTIFY → in-process fan-out → SSE.
//
//  A write issues `pg_notify('forum_events', payload)`. EVERY server instance
//  connected to the same database holds one long-lived LISTEN connection, so a
//  NOTIFY from any instance reaches all instances, which push it to their
//  connected SSE clients. That gives true multi-server, multi-device realtime
//  with no external broker.
//
//  Serverless note: long-lived LISTEN + SSE need a persistent Node server
//  (next start / a container). On Vercel serverless, swap this module's
//  transport for Supabase Realtime — the event shape below stays identical.
// ════════════════════════════════════════════════════════════════════════

import "server-only";
import { Client } from "pg";
import { prisma } from "@/lib/db";
import type { ForumEvent } from "@/lib/forum/types";

export type { ForumEvent };

const CHANNEL = "forum_events";
type Listener = (e: ForumEvent) => void;

// Survive Next.js dev hot-reload by stashing on globalThis.
const g = globalThis as unknown as {
  __forumListeners?: Set<Listener>;
  __forumPgInit?: Promise<void> | null;
};
g.__forumListeners ??= new Set<Listener>();

async function ensureListening(): Promise<void> {
  if (g.__forumPgInit) return g.__forumPgInit;
  g.__forumPgInit = (async () => {
    const client = new Client({ connectionString: process.env.DATABASE_URL });
    client.on("notification", (msg) => {
      if (!msg.payload) return;
      try {
        const e = JSON.parse(msg.payload) as ForumEvent;
        for (const l of g.__forumListeners!) l(e);
      } catch { /* ignore malformed payloads */ }
    });
    client.on("error", () => { g.__forumPgInit = null; }); // allow reconnect on next subscribe
    await client.connect();
    await client.query(`LISTEN ${CHANNEL}`);
  })().catch((err) => { g.__forumPgInit = null; throw err; });
  return g.__forumPgInit;
}

/** Register an SSE listener; returns an unsubscribe fn. */
export async function subscribe(fn: Listener): Promise<() => void> {
  await ensureListening();
  g.__forumListeners!.add(fn);
  return () => { g.__forumListeners!.delete(fn); };
}

/** Broadcast an event to every server instance (and thus every SSE client). */
export async function publish(e: ForumEvent): Promise<void> {
  // Channel is a constant; payload is parameterized.
  await prisma.$executeRawUnsafe(`SELECT pg_notify('${CHANNEL}', $1)`, JSON.stringify(e));
}
