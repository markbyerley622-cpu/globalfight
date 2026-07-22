"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

// ════════════════════════════════════════════════════════════════════════════
//  Cross-tab follow synchronisation.
//
//  Mounted once in AppShell, so it exists on every page regardless of what is
//  rendered. The listener used to live inside FollowButton, which was wrong in
//  the exact case that matters: a tab showing a feed with no follow buttons on
//  it had no listener at all, so the tab most in need of updating was the one
//  that never heard.
//
//  The message carries NO payload. It is a bare "something changed, go and
//  look" — the receiving tab re-derives from Postgres through router.refresh()
//  like everything else. A message carrying state would be a second source of
//  truth travelling between tabs, which is the thing this design avoids.
// ════════════════════════════════════════════════════════════════════════════

const CHANNEL = "cr-follow";

/** Ping every other tab. Safe to call anywhere; a no-op where unsupported. */
export function broadcastFollowChange(): void {
  if (typeof BroadcastChannel === "undefined") return;
  try {
    const ch = new BroadcastChannel(CHANNEL);
    ch.postMessage(1);
    ch.close();
  } catch {
    /* never let a sync nicety break a mutation that already succeeded */
  }
}

export function FollowSync() {
  const router = useRouter();
  useEffect(() => {
    if (typeof BroadcastChannel === "undefined") return;
    const ch = new BroadcastChannel(CHANNEL);
    ch.onmessage = () => router.refresh();
    return () => ch.close();
  }, [router]);
  return null;
}
