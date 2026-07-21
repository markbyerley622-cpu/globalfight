"use client";

import { useEffect, useRef, useState } from "react";
import { CalendarPlus, Download } from "lucide-react";
import { googleCalendarUrl, outlookCalendarUrl, type CalendarEvent } from "@/lib/calendar";
import { cn } from "@/lib/utils";

/**
 * Add to Calendar — Google, Apple, Outlook, or a plain .ics download.
 *
 * Apple and Outlook-desktop both consume ICS, so they point at the SAME server
 * route that generates the file; only Google and Outlook Web need a compose
 * deep link. The event is passed in as plain serialisable props, so the ICS the
 * server writes and the deep links the client builds describe the same block.
 */
export function AddToCalendar({
  slug, name, date, location, broadcaster, bouts, size = "md",
}: {
  slug: string;
  name: string;
  /** ISO string — the server is the source of truth for the actual time. */
  date: string;
  location?: string | null;
  broadcaster?: string | null;
  bouts?: number;
  size?: "sm" | "md";
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    window.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    return () => { window.removeEventListener("mousedown", onDown); window.removeEventListener("keydown", onKey); };
  }, [open]);

  const url = typeof window !== "undefined" ? `${window.location.origin}/events/${slug}` : `/events/${slug}`;
  const event: CalendarEvent = {
    uid: `event-${slug}@combatreviews`,
    title: name,
    start: new Date(date),
    description: [
      bouts ? `${bouts} bout${bouts === 1 ? "" : "s"}.` : null,
      broadcaster ? `Watch: ${broadcaster}.` : null,
      `Card, predictions and discussion: ${url}`,
    ].filter(Boolean).join(" "),
    location: location ?? undefined,
    url,
  };
  const ics = `/api/events/${encodeURIComponent(slug)}/calendar.ics`;

  const items: { key: string; label: string; href: string; download?: boolean }[] = [
    { key: "google", label: "Google Calendar", href: googleCalendarUrl(event) },
    { key: "apple", label: "Apple Calendar", href: ics, download: true },
    { key: "outlook", label: "Outlook", href: outlookCalendarUrl(event) },
    { key: "ics", label: "Download .ics", href: ics, download: true },
  ];

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        className={cn(
          "inline-flex items-center gap-1.5 rounded-lg border border-ink-700 font-semibold text-fog transition-colors hover:border-blood-500/40 hover:text-blood-300 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blood-400",
          size === "sm" ? "px-2.5 py-1 text-xs" : "px-3.5 py-2 text-sm",
        )}
      >
        <CalendarPlus className={size === "sm" ? "size-3.5" : "size-4"} /> Add to calendar
      </button>

      {open && (
        <div role="menu" className="absolute right-0 z-50 mt-2 w-48 overflow-hidden rounded-xl border border-ink-700 bg-ink-900 p-1.5 shadow-2xl shadow-black/40">
          {items.map((i) => (
            <a
              key={i.key}
              role="menuitem"
              href={i.href}
              {...(i.download ? { download: "" } : { target: "_blank", rel: "noopener noreferrer" })}
              onClick={() => setOpen(false)}
              className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm text-mist transition-colors hover:bg-ink-800 hover:text-chalk"
            >
              {i.key === "ics" && <Download className="size-4" />}
              {i.label}
            </a>
          ))}
        </div>
      )}
    </div>
  );
}
