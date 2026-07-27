"use client";

import { CheckCheck, RefreshCw } from "lucide-react";
import { useNotifications } from "@/lib/notifications-client";
import { NotificationList } from "@/components/notifications/notification-list";

/**
 * The full notification centre body.
 *
 * Deliberately thin: the rows, the grouping, the pagination, the optimistic
 * read/delete and the polling all live in the shared hook and the shared list, so
 * this is the page's own toolbar and nothing more. The alternative — a page-specific
 * copy of the list — is how the sheet and the page start disagreeing about what a
 * read notification looks like.
 */
export function NotificationCentre() {
  const state = useNotifications();
  const unreadOnScreen = (state.groups ?? []).some((g) => g.unread);

  return (
    <section className="mt-6">
      <div className="mb-3 flex items-center justify-between gap-3 border-b border-ink-800 pb-3">
        <p className="text-sm text-mist" role="status">
          {state.groups === null
            ? "Loading…"
            : state.unread > 0
              ? <><span className="font-semibold text-chalk">{state.unread}</span> unread</>
              : "Nothing unread"}
        </p>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => void state.refresh()}
            aria-label="Refresh notifications"
            className="tap grid size-9 place-items-center rounded-lg border border-ink-700 text-mist transition-colors hover:border-ink-600 hover:text-chalk focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blood-400"
          >
            {/* motion-safe: the spin is decoration, and a reader who asked their OS
                for reduced motion should not get a spinning icon on every poll. */}
            <RefreshCw className="size-4 motion-safe:transition-transform" />
          </button>
          {unreadOnScreen && (
            <button
              type="button"
              onClick={state.markAllRead}
              className="tap inline-flex items-center gap-1.5 rounded-lg border border-ink-700 px-3 py-2 text-xs font-semibold uppercase tracking-wide text-mist transition-colors hover:border-ink-600 hover:text-chalk focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blood-400"
            >
              <CheckCheck aria-hidden className="size-3.5" />
              <span className="max-sm:sr-only">Mark all read</span>
            </button>
          )}
        </div>
      </div>

      <NotificationList state={state} emptyAction={{ href: "/schedule", label: "Find cards to follow" }} />
    </section>
  );
}
