"use client";

import { useEffect } from "react";
import { track } from "@/lib/analytics-client";

/** Fires one analytics event when it mounts (a "view"). */
export function TrackView({ name, props }: { name: string; props?: Record<string, unknown> }) {
  useEffect(() => { track(name, props); }, [name, props]);
  return null;
}

/** Wraps content and fires an event on click, without preventing navigation
 *  (Link/anchor children still navigate; sendBeacon flushes first). */
export function TrackClick({
  name, props, children, className,
}: {
  name: string; props?: Record<string, unknown>; children: React.ReactNode; className?: string;
}) {
  return (
    <div className={className} onClick={() => track(name, props)}>
      {children}
    </div>
  );
}
