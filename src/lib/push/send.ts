import "server-only";
import { prisma } from "@/lib/db";
import { log } from "@/lib/scraper/logger";
import { mayPush, type NotifPrefs } from "./policy";

// ════════════════════════════════════════════════════════════════════════════
//  Web Push delivery.
//
//  The app already had a complete in-app notification system — model, eleven
//  types, dedupeKey idempotency, a scheduled return-engine, an unread bell.
//  What it did not have was any way to reach a user who had closed the tab, and
//  a sports app lives or dies on that.
//
//  This is delivery ONLY. It creates no notifications and owns no content: the
//  existing write paths (notify() and the return engine's bulk createMany) call
//  it after they have written the row. If push fails, the in-app notification
//  is already saved — a dead endpoint must never cost someone their alert.
//
//  Env-gated exactly like the email boundary: unconfigured means "do nothing",
//  never "pretend". Set VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY / VAPID_SUBJECT.
//  Generate a pair with `npx web-push generate-vapid-keys`.
// ════════════════════════════════════════════════════════════════════════════

export interface PushPayload {
  title: string;
  body?: string | null;
  url?: string | null;
  icon?: string | null;
  /** Collapses replacing notifications on the device (one per event, not ten). */
  tag?: string;
}

export function isPushConfigured(): boolean {
  return !!(process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY);
}

/** The key the browser needs to subscribe. Public by definition. */
export function publicVapidKey(): string | null {
  return process.env.VAPID_PUBLIC_KEY ?? null;
}

type WebPush = typeof import("web-push");
let configured: WebPush | null = null;

async function client(): Promise<WebPush | null> {
  if (!isPushConfigured()) return null;
  if (configured) return configured;
  const webpush = (await import("web-push")).default as unknown as WebPush;
  webpush.setVapidDetails(
    process.env.VAPID_SUBJECT ?? "mailto:support@example.com",
    process.env.VAPID_PUBLIC_KEY!,
    process.env.VAPID_PRIVATE_KEY!,
  );
  configured = webpush;
  return configured;
}

const PREF_SELECT = {
  notifyFights: true, notifyPredictions: true, notifySocial: true, notifyGym: true,
  quietHoursStart: true, quietHoursEnd: true, timezone: true,
} as const;

/**
 * Push one payload to every device belonging to these users, subject to their
 * category preferences and quiet hours.
 *
 * Never throws. Delivery is best-effort by nature — the source of truth is the
 * Notification row that was already written.
 */
export async function pushToUsers(
  userIds: string[],
  type: string,
  payload: PushPayload,
): Promise<{ sent: number; skipped: number }> {
  const webpush = await client();
  if (!webpush || userIds.length === 0) return { sent: 0, skipped: userIds.length };

  try {
    const users = await prisma.user.findMany({
      where: { id: { in: [...new Set(userIds)] } },
      select: { id: true, ...PREF_SELECT, pushSubscriptions: { select: { id: true, endpoint: true, p256dh: true, auth: true } } },
    });

    const now = new Date();
    let sent = 0;
    let skipped = 0;
    const dead: string[] = [];

    await Promise.all(
      users.flatMap((u) => {
        if (!mayPush(type, u as unknown as NotifPrefs, now)) {
          skipped += u.pushSubscriptions.length;
          return [];
        }
        return u.pushSubscriptions.map(async (sub) => {
          try {
            await webpush.sendNotification(
              { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
              JSON.stringify(payload),
              { TTL: 60 * 60 * 6 },
            );
            sent++;
          } catch (e) {
            const status = (e as { statusCode?: number }).statusCode;
            // 404/410 = the browser revoked this endpoint. It will never work
            // again, so drop it rather than retrying forever.
            if (status === 404 || status === 410) dead.push(sub.id);
            else {
              await prisma.pushSubscription
                .update({ where: { id: sub.id }, data: { failedCount: { increment: 1 } } })
                .catch(() => {});
            }
          }
        });
      }),
    );

    if (dead.length) {
      await prisma.pushSubscription.deleteMany({ where: { id: { in: dead } } }).catch(() => {});
    }
    return { sent, skipped };
  } catch (e) {
    log.warn({ err: (e as Error).message }, "push:deliver-failed");
    return { sent: 0, skipped: userIds.length };
  }
}
