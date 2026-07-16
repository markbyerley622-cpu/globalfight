"use client";

import { useEffect, useRef } from "react";
import { FORUM_EVENT_TYPES, type ForumEvent } from "@/lib/forum/types";

/**
 * Subscribe to forum realtime over SSE (Postgres LISTEN/NOTIFY upstream).
 * `onChange` fires with the event (or null on a polling tick). Polling is only
 * a fallback that engages if the SSE stream errors, and is torn down once SSE
 * reconnects — it is never the primary transport.
 */
export function useForumStream(params: {
  thread?: string;
  category?: string;
  onChange: (e: ForumEvent | null) => void;
}) {
  const onChangeRef = useRef(params.onChange);
  onChangeRef.current = params.onChange;

  const query = params.thread
    ? `thread=${encodeURIComponent(params.thread)}`
    : params.category
      ? `category=${encodeURIComponent(params.category)}`
      : "";

  useEffect(() => {
    let es: EventSource | null = null;
    let poll: ReturnType<typeof setInterval> | null = null;
    const startPolling = () => { if (!poll) poll = setInterval(() => onChangeRef.current(null), 8000); };
    const stopPolling = () => { if (poll) { clearInterval(poll); poll = null; } };

    try {
      es = new EventSource(`/api/forums/stream?${query}`);
      const handler = (ev: MessageEvent) => {
        let parsed: ForumEvent | null = null;
        try { parsed = JSON.parse(ev.data) as ForumEvent; } catch { parsed = null; }
        onChangeRef.current(parsed);
      };
      for (const t of FORUM_EVENT_TYPES) es.addEventListener(t, handler as EventListener);
      es.onopen = stopPolling;            // SSE healthy → no polling
      es.onerror = startPolling;          // SSE down → poll until it recovers
    } catch {
      startPolling();
    }

    return () => {
      stopPolling();
      if (es) es.close();
    };
  }, [query]);
}
