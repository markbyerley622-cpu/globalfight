"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { Bell, Loader2 } from "lucide-react";
import { Sheet } from "@/components/ui/sheet";

interface Notif {
  id: string; type: string; title: string; body: string | null;
  url: string | null; icon: string | null; readAt: string | null; createdAt: string;
}

/** Personal notification bell — unread badge + a sheet listing the viewer's
 *  engine-generated notifications (pick results, cards, follows). Reads
 *  /api/me/notifications; marks read on open. Rendered only when signed in. */
export function NotificationBell() {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<Notif[] | null>(null);
  const [unread, setUnread] = useState(0);

  const load = useCallback(async () => {
    try {
      const d = await (await fetch("/api/me/notifications")).json();
      setItems(d.notifications ?? []);
      setUnread(d.unread ?? 0);
    } catch { setItems([]); }
  }, []);

  // Initial + periodic unread poll.
  useEffect(() => {
    load();
    const id = setInterval(load, 60_000);
    return () => clearInterval(id);
  }, [load]);

  async function openSheet() {
    setOpen(true);
    if (items === null) await load();
    if (unread > 0) {
      setUnread(0);
      fetch("/api/me/notifications", { method: "POST" }).catch(() => {});
    }
  }

  return (
    <>
      <button
        onClick={openSheet}
        aria-label="Notifications"
        className="relative rounded-lg border border-ink-700 bg-ink-850/60 p-2 text-mist transition-colors hover:border-ink-600 hover:text-chalk"
      >
        <Bell className="size-4" />
        {unread > 0 && (
          <span className="absolute -right-1 -top-1 grid min-w-[1.05rem] place-items-center rounded-full bg-blood-500 px-1 text-[0.6rem] font-bold tabular-nums text-white">
            {unread > 9 ? "9+" : unread}
          </span>
        )}
      </button>

      <Sheet open={open} onClose={() => setOpen(false)} title="Notifications">
        <div className="px-3 pb-3">
          {items === null ? (
            <div className="flex items-center justify-center gap-2 py-10 text-mist"><Loader2 className="size-4 animate-spin" /> Loading…</div>
          ) : items.length === 0 ? (
            <p className="py-10 text-center text-sm text-fog">You&apos;re all caught up. Make some picks and check back after the fights.</p>
          ) : (
            items.map((n) => {
              const inner = (
                <div className={`flex items-start gap-3 rounded-xl border px-3 py-2.5 ${n.readAt ? "border-ink-800 bg-ink-900" : "border-blood-500/30 bg-blood-500/5"}`}>
                  <span className="text-base leading-none">{n.icon ?? "🔔"}</span>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold text-chalk">{n.title}</p>
                    {n.body && <p className="mt-0.5 text-xs text-mist">{n.body}</p>}
                  </div>
                </div>
              );
              return (
                <div key={n.id} className="mb-2">
                  {n.url ? <Link href={n.url} onClick={() => setOpen(false)}>{inner}</Link> : inner}
                </div>
              );
            })
          )}
        </div>
      </Sheet>
    </>
  );
}
