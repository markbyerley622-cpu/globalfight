"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { MessageSquare } from "lucide-react";

/** How often the header asks whether anything new has arrived. */
const POLL_MS = 45_000;

/**
 * The DM entry point, beside the notification bell.
 *
 * A link, not a button opening a sheet: a conversation is a place you go and
 * stay, not a thing you glance at, and making it a real URL means it is
 * shareable, back-navigable and works without JavaScript.
 *
 * It polls only the COUNT (/api/messages/unread), never the inbox — this fires
 * on every signed-in page, and serving every thread with its last message to
 * render one integer would make the most frequent request in the app one of the
 * most expensive. Rendered only when signed in; an anonymous header has nothing
 * to badge.
 */
export function MessagesButton() {
  const [unread, setUnread] = useState(0);
  const pathname = usePathname();

  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const res = await fetch("/api/messages/unread", { cache: "no-store" });
        if (!res.ok || !alive) return;
        const data = (await res.json()) as { unread: number };
        setUnread(data.unread ?? 0);
      } catch { /* a dropped poll just leaves the last known count */ }
    };
    void load();
    const t = setInterval(load, POLL_MS);
    return () => { alive = false; clearInterval(t); };
    // Re-checked on navigation too: opening a thread clears its unread server-
    // side, and the badge must not keep claiming messages you have just read.
  }, [pathname]);

  return (
    <Link
      href="/messages"
      // The count is IN the label. "Messages" alone tells a screen-reader user
      // nothing about whether it is worth opening — the same rule the bell uses.
      aria-label={unread > 0 ? `Messages — ${unread} unread` : "Messages"}
      className="relative rounded-lg border border-ink-700 bg-ink-850/60 p-2 text-mist transition-colors hover:border-ink-600 hover:text-chalk focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blood-400"
    >
      <MessageSquare className="size-4" />
      {unread > 0 && (
        <span
          aria-hidden
          className="absolute -right-1 -top-1 grid min-w-[1.05rem] place-items-center rounded-full bg-blood-500 px-1 text-[0.6rem] font-bold tabular-nums text-white"
        >
          {unread > 9 ? "9+" : unread}
        </span>
      )}
    </Link>
  );
}
