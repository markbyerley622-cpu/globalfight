"use client";

import { useState } from "react";
import Link from "next/link";
import { Bell, CheckCheck } from "lucide-react";
import { Sheet } from "@/components/ui/sheet";
import { track } from "@/lib/analytics-client";
import { useNotifications } from "@/lib/notifications-client";
import { NotificationList } from "@/components/notifications/notification-list";

/** Personal notification bell — unread badge + a sheet listing the viewer's
 *  engine-generated notifications (results, cards, follows, gym reviews).
 *
 *  Both the rows and the transport are shared with /notifications: this component
 *  is the badge, the sheet and a link to the full centre, and nothing else. It used
 *  to own its own fetch loop and its own copy of the unread count, which is how a
 *  badge ends up disagreeing with the list directly beneath it.
 *
 *  Rendered only when signed in. */
export function NotificationBell() {
  const [open, setOpen] = useState(false);
  const state = useNotifications();

  return (
    <>
      <button
        onClick={() => { setOpen(true); track("notification_open", { unread: state.unread }); }}
        // The count is IN the label: "Notifications" alone tells a screen-reader
        // user nothing about whether it is worth opening.
        aria-label={state.unread > 0 ? `Notifications — ${state.unread} unread` : "Notifications"}
        aria-haspopup="dialog"
        aria-expanded={open}
        className="relative rounded-lg border border-ink-700 bg-ink-850/60 p-2 text-mist transition-colors hover:border-ink-600 hover:text-chalk focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blood-400"
      >
        <Bell className="size-4" />
        {state.unread > 0 && (
          <span
            aria-hidden
            className="absolute -right-1 -top-1 grid min-w-[1.05rem] place-items-center rounded-full bg-blood-500 px-1 text-3xs font-bold tabular-nums text-white"
          >
            {state.unread > 9 ? "9+" : state.unread}
          </span>
        )}
      </button>

      <Sheet open={open} onClose={() => setOpen(false)} title="Notifications">
        <div className="px-3 pb-3">
          {/* Opening the sheet no longer marks everything read. Reading a row is
              what marks that row read — a sweep on open silently destroyed the
              unread state of everything the reader had not yet scrolled to. */}
          <div className="mb-2 flex items-center justify-between gap-2">
            <Link
              href="/notifications"
              onClick={() => setOpen(false)}
              className="text-xs font-semibold uppercase tracking-wide text-mist transition-colors hover:text-chalk focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blood-400"
            >
              See all
            </Link>
            {state.unread > 0 && (
              <button
                type="button"
                onClick={state.markAllRead}
                className="tap inline-flex items-center gap-1.5 rounded-lg border border-ink-700 px-2.5 py-1.5 text-xs font-semibold text-mist transition-colors hover:text-chalk focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blood-400"
              >
                <CheckCheck className="size-3.5" /> Mark all read
              </button>
            )}
          </div>

          <NotificationList state={state} onNavigate={() => setOpen(false)} />
        </div>
      </Sheet>
    </>
  );
}
