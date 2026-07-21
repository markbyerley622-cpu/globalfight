import "server-only";
import { prisma } from "@/lib/db";

// ── First-party analytics ───────────────────────────────────────────────────
// Cookieless, first-party product analytics — no third-party scripts, no
// tracking cookie. Signed-in events carry userId; anonymous ones carry none.
// recordEvent NEVER throws or blocks the caller — instrumentation must not be
// able to break a user action.

/** The only event names we store — an allow-list keeps the table clean and the
 *  metrics well-defined. Add here first, then emit. */
export const EVENTS = [
  "pageview",
  "home_view",
  "home_rail_click",
  "prediction_made",
  "prediction_changed",
  "follow_fighter",
  "follow_promotion",
  // Following an EVENT is the strongest Phase-1 intent signal ("remind me"), and
  // calendar export is the moment the product leaves the app and lives in the
  // surface the fan already checks. Both are tracked as first-class conversions.
  "follow_event",
  "calendar_add",
  "notification_open",
  "notification_click",
  "result_reveal_view",
  "signup",
] as const;
export type EventName = (typeof EVENTS)[number];

const ALLOWED = new Set<string>(EVENTS);
export const isEventName = (v: unknown): v is EventName => typeof v === "string" && ALLOWED.has(v);

/** Fire-and-forget event write. Swallows everything — never awaited on a hot path
 *  in a way that could surface an error to the user. */
export async function recordEvent(input: {
  name: EventName;
  userId?: string | null;
  path?: string | null;
  props?: Record<string, unknown> | null;
}): Promise<void> {
  try {
    await prisma.analyticsEvent.create({
      data: {
        name: input.name,
        userId: input.userId ?? null,
        path: input.path ?? null,
        props: (input.props ?? undefined) as object | undefined,
      },
    });
  } catch {
    // Analytics must never break the app.
  }
}

/** Convenience for server code that already has the user: emit without awaiting. */
export function track(name: EventName, userId?: string | null, props?: Record<string, unknown>): void {
  void recordEvent({ name, userId, props });
}
