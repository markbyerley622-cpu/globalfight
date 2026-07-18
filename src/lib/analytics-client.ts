"use client";

// Client-side event emitter. Fire-and-forget POST to /api/track using
// sendBeacon when available (survives navigation), else a keepalive fetch.
// Never awaited, never throws.
export function track(name: string, props?: Record<string, unknown>, path?: string): void {
  try {
    const body = JSON.stringify({ name, props, path: path ?? (typeof location !== "undefined" ? location.pathname : undefined) });
    if (typeof navigator !== "undefined" && navigator.sendBeacon) {
      navigator.sendBeacon("/api/track", new Blob([body], { type: "application/json" }));
    } else {
      void fetch("/api/track", { method: "POST", headers: { "content-type": "application/json" }, body, keepalive: true });
    }
  } catch {
    // ignore
  }
}
