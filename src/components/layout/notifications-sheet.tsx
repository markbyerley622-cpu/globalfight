"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Newspaper, CalendarDays, Trophy, Loader2 } from "lucide-react";
import { Sheet } from "@/components/ui/sheet";
import { useT } from "@/lib/i18n";
import type { Notification, NotificationKind } from "@/app/api/notifications/route";

const ICON: Record<NotificationKind, typeof Newspaper> = {
  news: Newspaper,
  event: CalendarDays,
  result: Trophy,
};
const TINT: Record<NotificationKind, string> = {
  news: "text-gold-400",
  event: "text-volt-400",
  result: "text-up",
};

/** Notifications sheet behind the top-bar bell. Fetches /api/notifications. */
export function NotificationsSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const t = useT();
  const [items, setItems] = useState<Notification[] | null>(null);

  useEffect(() => {
    if (!open) return;
    let live = true;
    setItems(null);
    fetch("/api/notifications")
      .then((r) => r.json())
      .then((d) => { if (live) setItems(d.notifications ?? []); })
      .catch(() => { if (live) setItems([]); });
    return () => { live = false; };
  }, [open]);

  return (
    <Sheet open={open} onClose={onClose} title={t("Notifications")}>
      <div className="px-3 pb-2">
        {items === null ? (
          <div className="flex items-center justify-center gap-2 py-10 text-mist">
            <Loader2 className="size-4 animate-spin" /> {t("Loading…")}
          </div>
        ) : items.length === 0 ? (
          <p className="py-10 text-center text-sm text-fog">{t("You're all caught up.")}</p>
        ) : (
          items.map((n) => {
            const Icon = ICON[n.kind];
            return (
              <Link
                key={n.id}
                href={n.href}
                onClick={onClose}
                className="flex items-start gap-3 rounded-xl px-3 py-3 transition-colors hover:bg-ink-800"
              >
                <span className="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-xl border border-ink-700 bg-ink-800">
                  <Icon className={`size-[1.05rem] ${TINT[n.kind]}`} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-semibold leading-snug text-chalk">{n.title}</span>
                  <span className="mt-0.5 block truncate text-xs text-fog">{n.sub}</span>
                </span>
              </Link>
            );
          })
        )}
      </div>
      <div className="px-5 pt-1">
        <Link
          href="/news"
          onClick={onClose}
          className="flex w-full items-center justify-center rounded-xl border border-ink-700 bg-ink-800 py-2.5 font-display text-sm font-semibold uppercase tracking-wide text-chalk transition-colors hover:border-blood-500/50"
        >
          {t("All news")}
        </Link>
      </div>
    </Sheet>
  );
}
