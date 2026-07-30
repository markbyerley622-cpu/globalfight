"use client";

import { useEffect, useState } from "react";
import { CalendarClock } from "lucide-react";
import type { EventStatus } from "@/lib/types";
import type { Coverage } from "@/lib/events/result-coverage";

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

export interface ScheduleBlock {
  key: string;
  label: string;
  /** ISO start time for the block. */
  startsAt: string;
  bouts: number;
}

/**
 * The schedule — deliberately the loudest thing above the fold after the hero.
 * A live ticking clock to the first bell that ramps up urgency as the event
 * nears (pulsing glow inside 24h), the date in the viewer's own timezone, and
 * the running order of the night's broadcast blocks.
 * Standard across every combat sport: same block, same position, every event.
 */
export function EventSchedule({
  date, status, blocks, estimated, coverage,
}: {
  date: string;
  status: EventStatus;
  /** Broadcast blocks, earliest first. Omitted for a card with nothing to split. */
  blocks?: ScheduleBlock[];
  /** True when the blocks were derived rather than supplied by a provider. */
  estimated?: boolean;
  /**
   * Result completeness, from the ONE shared calculation
   * (lib/events/result-coverage). Supplied by the page, which knows the bouts.
   *
   * Without it this banner derived its status from `status` alone and had no idea
   * whether any result had landed — so it announced "Results pending · sources are
   * checked hourly" directly above a card displaying "TKO Round 7". Two statements
   * on one screen, contradicting each other, and the wrong one was the loud one.
   */
  coverage?: Coverage;
}) {
  const target = new Date(date).getTime();
  const [t, setT] = useState<ReturnType<typeof diff>>(null);
  // Has first bell passed? `null` means "not measured yet".
  //
  // This CANNOT be derived from `t` being null, which is what the component used to
  // do, and it produced two separate wrong states:
  //
  //  • A card whose date has passed while its status is still SCHEDULED — i.e. every
  //    card between the final bell and the results landing — rendered the eyebrow
  //    "First bell in" ABOVE the words "Card finished". Both from the same render.
  //  • `t` is also null on the FIRST render of an upcoming card, before the effect
  //    runs, so every future event flashed "Card finished" before hydration.
  //
  // Measured in the effect rather than inline so server and client cannot disagree
  // about the current time and trip a hydration mismatch.
  const [started, setStarted] = useState<boolean | null>(null);
  const [local, setLocal] = useState<string>("");

  useEffect(() => {
    setT(diff(target));
    setStarted(target <= Date.now());
    setLocal(
      new Intl.DateTimeFormat(undefined, {
        weekday: "long", month: "short", day: "numeric",
        hour: "numeric", minute: "2-digit", timeZoneName: "short",
      }).format(new Date(target)),
    );
    const id = setInterval(() => {
      setT(diff(target));
      setStarted(target <= Date.now());
    }, 1000);
    return () => clearInterval(id);
  }, [target]);

  const isLive = status === "LIVE";
  const isDone = status === "COMPLETED";
  /**
   * The card has happened, but no result has been recorded yet.
   *
   * This is a REAL state, not an edge case: results arrive from an ingest that runs
   * hourly, so every card sits here for a while after the final bell. Saying
   * "Results pending" is both true and actionable; saying "Card finished" next to
   * "First bell in" told the reader two contradictory things and neither of them was
   * that we are still waiting on sources.
   */
  const awaitingResults = started === true && !isLive && !isDone;
  // Prefer the measured coverage over the crude "started and not marked COMPLETED"
  // guess. `coverage` knows how many bouts actually carry an outcome; `status` does
  // not, which is the whole reason the banner could contradict the card below it.
  const post = awaitingResults || isDone;
  const cov = post ? coverage : undefined;
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
        {isLive
          ? "Happening now"
          : cov
            ? cov.label
            : isDone
              ? "Event complete"
              : awaitingResults
                ? "Awaiting results"
                : soon
                  ? "Starting soon"
                  : "First bell in"}
      </div>

      {isLive ? (
        <p className="text-center font-display text-2xl font-black uppercase tracking-wide text-blood-400">
          <span className="live-dot mr-2 inline-block align-middle" aria-hidden /> Live now
        </p>
      ) : cov ? (
        // ONE string set, from lib/events/result-coverage. A 100%-confirmed card reads
        // "Final"; a partial one says how many of how many and whether more is coming;
        // an exhausted one stops promising an update that will never arrive.
        <p className="text-center font-display text-2xl font-black uppercase tracking-wide text-mist">
          {cov.state === "CONFIRMED" ? "Final" : `${cov.decided} of ${cov.total} confirmed`}
          {cov.detail && (
            <span className="mt-1 block font-sans text-[0.68rem] font-normal normal-case tracking-normal text-fog">
              {cov.detail}
            </span>
          )}
        </p>
      ) : isDone ? (
        <p className="text-center font-display text-2xl font-black uppercase tracking-wide text-mist">Final</p>
      ) : awaitingResults ? (
        <p className="text-center font-display text-2xl font-black uppercase tracking-wide text-mist">
          Results pending
          <span className="mt-1 block font-sans text-[0.68rem] font-normal normal-case tracking-normal text-fog">
            Sources are checked hourly.
          </span>
        </p>
      ) : t ? (
        <div className={`flex items-center justify-center gap-3 sm:gap-5 ${urgent ? "text-blood-300" : ""}`}>
          {cell(t.days, "Days")}
          <span className="pb-4 text-2xl text-ink-700">:</span>
          {cell(t.hours, "Hrs")}
          <span className="pb-4 text-2xl text-ink-700">:</span>
          {cell(t.minutes, "Min")}
          <span className="pb-4 text-2xl text-ink-700">:</span>
          {cell(t.seconds, "Sec", soon)}
        </div>
      ) : (
        // Pre-hydration only: the clock has not been measured yet. Zeroed cells hold
        // the exact layout the real countdown will occupy, so the number swaps in
        // without shifting anything. Previously this branch printed "Card finished"
        // on every upcoming event for one frame.
        <div aria-hidden className="flex items-center justify-center gap-3 opacity-40 sm:gap-5">
          {cell(0, "Days")}
          <span className="pb-4 text-2xl text-ink-700">:</span>
          {cell(0, "Hrs")}
          <span className="pb-4 text-2xl text-ink-700">:</span>
          {cell(0, "Min")}
          <span className="pb-4 text-2xl text-ink-700">:</span>
          {cell(0, "Sec")}
        </div>
      )}

      {local && (
        <p className="mt-4 text-center text-xs text-fog">
          {local} <span className="text-mist">· your time</span>
        </p>
      )}

      {/* Running order. A fan asks "when is my guy on?" before anything else —
          every time is shown in their OWN timezone, and flagged as an estimate
          whenever we derived the split rather than being told it. */}
      {blocks && blocks.length > 1 && (
        <div className="mx-auto mt-5 max-w-md">
          <ol className="divide-y divide-ink-800 overflow-hidden rounded-xl border border-ink-700 bg-ink-950/40">
            {blocks.map((b) => (
              <li key={b.key} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
                <span className="font-display font-semibold text-chalk">{b.label}</span>
                <span className="flex items-center gap-2 text-xs text-fog">
                  <span className="tabular-nums">{b.bouts} bout{b.bouts === 1 ? "" : "s"}</span>
                  <LocalTime iso={b.startsAt} />
                </span>
              </li>
            ))}
          </ol>
          {estimated && (
            <p className="mt-1.5 text-center text-[0.65rem] text-fog">
              Block times estimated from the card — not an official broadcast schedule.
            </p>
          )}
        </div>
      )}
    </section>
  );
}

/**
 * A time rendered in the VIEWER's timezone. Server-rendered as an empty slot and
 * filled on mount: the server has no idea what timezone the reader is in, and
 * rendering a server-side guess would hydrate-mismatch and mislead.
 */
export function LocalTime({ iso, className }: { iso: string; className?: string }) {
  const [label, setLabel] = useState("");
  useEffect(() => {
    setLabel(new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" }).format(new Date(iso)));
  }, [iso]);
  return (
    <time dateTime={iso} className={className ?? "font-semibold tabular-nums text-mist"}>
      {label || "—"}
    </time>
  );
}
