"use client";

import { useEffect, useState } from "react";
import { CalendarClock } from "lucide-react";
import type { EventStatus } from "@/lib/types";

function diff(target: number) {
  const d = target - Date.now();
  if (d <= 0) return null;
  return {
    days: Math.floor(d / 86400000),
    hours: Math.floor((d % 86400000) / 3600000),
    minutes: Math.floor((d % 3600000) / 60000),
    seconds: Math.floor((d % 60000) / 1000),
    ms: d,
  };
}

/**
 * The schedule — deliberately the loudest thing above the fold after the hero.
 * A live ticking clock to the first bell that ramps up urgency as the event
 * nears (pulsing glow inside 24h), plus the date in the viewer's own timezone.
 * Standard across every combat sport: same block, same position, every event.
 */
export function EventSchedule({ date, status }: { date: string; status: EventStatus }) {
  const target = new Date(date).getTime();
  const [t, setT] = useState<ReturnType<typeof diff>>(null);
  const [local, setLocal] = useState<string>("");

  useEffect(() => {
    setT(diff(target));
    setLocal(
      new Intl.DateTimeFormat(undefined, {
        weekday: "long", month: "short", day: "numeric",
        hour: "numeric", minute: "2-digit", timeZoneName: "short",
      }).format(new Date(target)),
    );
    const id = setInterval(() => setT(diff(target)), 1000);
    return () => clearInterval(id);
  }, [target]);

  const isLive = status === "LIVE";
  const isDone = status === "COMPLETED";
  const urgent = !!t && t.ms < 86400000; // inside 24h
  const soon = !!t && t.ms < 3600000; // inside the hour

  const cell = (v: number, l: string, pulse = false) => (
    <div className="flex flex-col items-center">
      <span
        className={`font-display text-3xl font-black tabular-nums leading-none text-chalk sm:text-4xl ${pulse ? "animate-pulse text-blood-300" : ""}`}
      >
        {String(v).padStart(2, "0")}
      </span>
      <span className="mt-1 text-[0.6rem] uppercase tracking-widest text-fog">{l}</span>
    </div>
  );

  return (
    <section
      aria-label="Schedule"
      className="relative overflow-hidden border-b border-ink-700/70 px-4 py-6"
      style={
        urgent
          ? { boxShadow: "inset 0 0 60px -20px color-mix(in srgb, var(--accent, #e11d2a) 60%, transparent)" }
          : undefined
      }
    >
      <div className="mb-3 flex items-center justify-center gap-1.5 text-[0.65rem] font-semibold uppercase tracking-[0.2em] text-fog">
        <CalendarClock className="size-3.5" />
        {isLive ? "Happening now" : isDone ? "Event complete" : soon ? "Starting soon" : "First bell in"}
      </div>

      {isLive ? (
        <p className="text-center font-display text-2xl font-black uppercase tracking-wide text-blood-400">
          <span className="live-dot mr-2 inline-block align-middle" aria-hidden /> Live now
        </p>
      ) : isDone || !t ? (
        <p className="text-center font-display text-2xl font-black uppercase tracking-wide text-mist">
          {isDone ? "Final" : "Card finished"}
        </p>
      ) : (
        <div className={`flex items-center justify-center gap-3 sm:gap-5 ${urgent ? "text-blood-300" : ""}`}>
          {cell(t.days, "Days")}
          <span className="pb-4 text-2xl text-ink-700">:</span>
          {cell(t.hours, "Hrs")}
          <span className="pb-4 text-2xl text-ink-700">:</span>
          {cell(t.minutes, "Min")}
          <span className="pb-4 text-2xl text-ink-700">:</span>
          {cell(t.seconds, "Sec", soon)}
        </div>
      )}

      {local && (
        <p className="mt-4 text-center text-xs text-fog">
          {local} <span className="text-mist">· your time</span>
        </p>
      )}
    </section>
  );
}
