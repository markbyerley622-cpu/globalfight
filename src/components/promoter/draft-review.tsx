"use client";

import { useMemo } from "react";
import Image from "next/image";
import { CalendarDays, MapPin, Radio, Ticket, Sparkles } from "lucide-react";
import { Countdown } from "@/components/countdown";
import { InlineField } from "@/components/promoter/inline-field";
import { CardBuilder, type BoutRow } from "@/components/promoter/card-builder";
import { blockersToPublish, draftFilled, toEventDate, type EditableDraft } from "@/lib/promoter/draft";
import { cn } from "@/lib/utils";

// ════════════════════════════════════════════════════════════════════════════
//  THE REVIEW SCREEN — where the promoter meets the event the app just built.
//
//  ── The one job ───────────────────────────────────────────────────────────
//  Make them think "it did that from a picture?" and then let them fix the two
//  things it got wrong, in place, without ever leaving this screen.
//
//  Which is why this is NOT a form. It is the EVENT — poster, title, live
//  countdown, the card in bill order — rendered close to how a fan will see it,
//  with every value tappable. The promoter proofreads a finished thing instead
//  of filling in a blank one, and the difference is entirely psychological and
//  entirely the point.
//
//  ── Why the countdown is here, live, before publishing ────────────────────
//  It is the single fastest way to make an extracted date feel REAL. A field
//  reading "2026-11-14" is data; "89 days" ticking is an event. It is also the
//  best error detector on the screen — a mis-read year shows up instantly as a
//  countdown that says four hundred days, which no one misses, whereas the same
//  mistake in a date field is invisible.
//
//  ── What is deliberately absent ───────────────────────────────────────────
//  Step numbers, a wizard chrome, a "next" button, and any field the poster
//  already answered. There is one screen, and the only forward action is
//  Publish.
// ════════════════════════════════════════════════════════════════════════════

export function DraftReview({
  draft, onChange, posterUrl, disabled = false,
}: {
  draft: EditableDraft;
  onChange: (next: EditableDraft) => void;
  posterUrl: string | null;
  disabled?: boolean;
}) {
  const set = <K extends keyof EditableDraft>(key: K, value: EditableDraft[K]) =>
    onChange({ ...draft, [key]: value });

  const uncertain = (key: string) => draft.uncertainFields.has(key);

  const eventDate = useMemo(
    () => toEventDate(draft.date, draft.firstBellTime || draft.doorsTime),
    [draft.date, draft.firstBellTime, draft.doorsTime],
  );

  const filled = draftFilled(draft);
  const blockers = blockersToPublish(draft);
  const checkCount = draft.uncertainFields.size + draft.bouts.filter((b) => b.uncertain).length;

  return (
    <div className="space-y-4">
      {/* ── THE MOMENT ──────────────────────────────────────────────────────
          The first thing on screen after extraction, and the only place the app
          gets to say what it just did. It reports two numbers: what it found,
          and what is worth checking.

          The second number is what makes the first one trustworthy. "We built
          your event" alone invites the promoter to check all thirty fields
          because they have no idea which ones to doubt. Naming the shaky ones
          turns a full audit into two taps — and admitting uncertainty is what
          earns belief in everything not flagged. */}
      <div className="flex items-start gap-3 rounded-xl border border-volt-500/30 bg-volt-500/[0.07] p-3.5">
        <span className="mt-0.5 grid size-8 shrink-0 place-items-center rounded-lg bg-volt-500/15 text-volt-300">
          <Sparkles className="size-4" aria-hidden />
        </span>
        <div className="min-w-0">
          <p className="font-display text-sm font-black uppercase tracking-wide text-chalk">
            We built your event from the poster
          </p>
          <p className="mt-0.5 text-xs text-mist">
            {filled.done} of {filled.total} details filled in
            {draft.bouts.length > 0 && ` · ${draft.bouts.length} bout${draft.bouts.length === 1 ? "" : "s"}`}
            {checkCount > 0 && (
              <>
                {" · "}
                <span className="font-semibold text-volt-200">
                  {checkCount} worth a check
                </span>
              </>
            )}
            . Tap anything to change it.
          </p>
        </div>
      </div>

      {/* ── The event, as a fan will see it ──────────────────────────────── */}
      <div className="overflow-hidden rounded-2xl border border-ink-800 bg-ink-900/50">
        <div className="flex flex-col gap-4 p-4 sm:flex-row">
          {/* The poster, at the size it deserves. It is the thing they brought. */}
          {posterUrl && (
            <div className="relative mx-auto aspect-[3/4] w-40 shrink-0 overflow-hidden rounded-xl border border-ink-700 sm:mx-0 sm:w-44">
              <Image
                src={posterUrl}
                alt="Event poster"
                fill
                className="object-cover"
                sizes="176px"
                unoptimized
              />
            </div>
          )}

          <div className="min-w-0 flex-1 space-y-3">
            <InlineField
              value={draft.eventName}
              onCommit={(v) => set("eventName", v)}
              placeholder="Name your event"
              label="Event name"
              size="xl"
              uncertain={uncertain("eventName")}
              disabled={disabled}
              maxLength={120}
            />

            {/* THE COUNTDOWN. Live, before publishing — see the header. */}
            {eventDate && (
              <div className="rounded-xl border border-ink-800 bg-ink-950/60 p-3">
                <p className="mb-2 text-center font-display text-3xs font-bold uppercase tracking-[0.18em] text-fog">
                  First bell in
                </p>
                <Countdown date={eventDate.toISOString()} size="sm" />
              </div>
            )}

            <div className="space-y-1">
              <FactRow icon={CalendarDays} label="Date">
                <div className="flex flex-wrap items-center gap-1.5">
                  <DateField
                    value={draft.date}
                    onCommit={(v) => set("date", v)}
                    uncertain={uncertain("date")}
                    disabled={disabled}
                  />
                  <TimeField
                    value={draft.firstBellTime}
                    onCommit={(v) => set("firstBellTime", v)}
                    label="First bell"
                    uncertain={uncertain("firstBellTime")}
                    disabled={disabled}
                  />
                </div>
              </FactRow>

              <FactRow icon={MapPin} label="Where">
                <div className="min-w-0 flex-1">
                  <InlineField
                    value={draft.venue}
                    onCommit={(v) => set("venue", v)}
                    placeholder="Venue"
                    label="Venue"
                    uncertain={uncertain("venue")}
                    disabled={disabled}
                  />
                  <InlineField
                    value={draft.city}
                    onCommit={(v) => set("city", v)}
                    placeholder="City"
                    label="City"
                    size="sm"
                    uncertain={uncertain("city")}
                    disabled={disabled}
                  />
                </div>
              </FactRow>

              <FactRow icon={Radio} label="Watch">
                <div className="min-w-0 flex-1">
                  <InlineField
                    value={draft.broadcaster}
                    onCommit={(v) => set("broadcaster", v)}
                    placeholder="Broadcaster — optional"
                    label="Broadcaster"
                    size="sm"
                    disabled={disabled}
                  />
                </div>
              </FactRow>

              <FactRow icon={Ticket} label="Tickets">
                <div className="min-w-0 flex-1">
                  <InlineField
                    value={draft.ticketUrl}
                    onCommit={(v) => set("ticketUrl", v)}
                    placeholder="Ticket link — optional"
                    label="Ticket link"
                    size="sm"
                    inputMode="url"
                    disabled={disabled}
                  />
                </div>
              </FactRow>
            </div>
          </div>
        </div>

        {/* ── The card ─────────────────────────────────────────────────────── */}
        <div className="border-t border-ink-800 p-4">
          <div className="mb-3 flex items-baseline justify-between gap-3">
            <h2 className="font-display text-sm font-black uppercase tracking-wider text-chalk">
              Fight card
            </h2>
            <span className="text-3xs text-fog">
              {draft.bouts.length} bout{draft.bouts.length === 1 ? "" : "s"}
            </span>
          </div>
          <CardBuilder
            bouts={draft.bouts as BoutRow[]}
            onChange={(next) => set("bouts", next as EditableDraft["bouts"])}
            disabled={disabled}
          />
        </div>
      </div>

      {/* ── Leftovers ────────────────────────────────────────────────────────
          Everything the parser could not place, handed back rather than
          swallowed. The promoter is the only one who knows whether a leftover
          line was a sponsor (ignore it) or the broadcaster (we missed it), and
          hiding these makes every miss look like the poster never said it. */}
      {draft.leftovers.length > 0 && (
        <details className="rounded-xl border border-ink-800 bg-ink-900/40 px-3.5 py-2.5">
          <summary className="cursor-pointer text-xs font-semibold text-fog transition-colors hover:text-mist">
            {draft.leftovers.length} line{draft.leftovers.length === 1 ? "" : "s"} we couldn&apos;t place
          </summary>
          <ul className="mt-2 space-y-1 border-t border-ink-800 pt-2">
            {draft.leftovers.map((line, i) => (
              <li key={i} className="truncate text-xs text-mist">{line}</li>
            ))}
          </ul>
        </details>
      )}

      {blockers.length > 0 && (
        <p className="text-center text-xs text-fog">
          Before publishing: {blockers.join(" · ")}
        </p>
      )}
    </div>
  );
}

function FactRow({
  icon: Icon, label, children,
}: { icon: typeof MapPin; label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-2.5">
      <span className="mt-2 flex shrink-0 items-center gap-1.5 text-3xs font-bold uppercase tracking-wider text-fog">
        <Icon className="size-3.5 text-blood-400" aria-hidden />
        <span className="w-12">{label}</span>
      </span>
      {children}
    </div>
  );
}

/**
 * The date, as a native picker.
 *
 * The one place a real `<input type="date">` beats tap-to-edit text: it gives
 * a phone the OS date wheel, which is faster and — the actual reason — cannot
 * produce an ambiguous string. Typing a date freehand reintroduces exactly the
 * dd/mm-versus-mm/dd problem the parser refuses to guess at.
 */
function DateField({
  value, onCommit, uncertain, disabled,
}: { value: string; onCommit: (v: string) => void; uncertain: boolean; disabled: boolean }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <input
        type="date"
        value={value}
        disabled={disabled}
        onChange={(e) => onCommit(e.target.value)}
        aria-label="Event date"
        className={cn(
          "min-h-9 rounded-lg border bg-ink-950/60 px-2.5 text-sm text-chalk outline-none transition-colors focus:border-blood-500/60",
          uncertain ? "border-volt-500/50" : "border-ink-700",
        )}
      />
      {uncertain && (
        <span
          className="rounded-full border border-volt-500/40 bg-volt-500/10 px-1.5 py-0.5 font-display text-4xs font-bold uppercase tracking-wider text-volt-200"
          title="The poster didn't print a year, or we weren't sure — worth a check"
        >
          check
        </span>
      )}
    </span>
  );
}

function TimeField({
  value, onCommit, label, uncertain, disabled,
}: { value: string; onCommit: (v: string) => void; label: string; uncertain: boolean; disabled: boolean }) {
  return (
    <input
      type="time"
      value={value}
      disabled={disabled}
      onChange={(e) => onCommit(e.target.value)}
      aria-label={label}
      className={cn(
        "min-h-9 rounded-lg border bg-ink-950/60 px-2.5 text-sm text-chalk outline-none transition-colors focus:border-blood-500/60",
        uncertain ? "border-volt-500/50" : "border-ink-700",
      )}
    />
  );
}
