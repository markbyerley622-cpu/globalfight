"use client";

import { useEffect, useId, useRef, useState } from "react";
import { Check, Pencil, X } from "lucide-react";
import { cn } from "@/lib/utils";

// ════════════════════════════════════════════════════════════════════════════
//  TAP · EDIT · DONE — the primitive the whole promoter flow is built on.
//
//  ── Why this exists ───────────────────────────────────────────────────────
//  An event has roughly thirty editable facts. The conventional answer is a
//  form, or worse, a page of forms behind an "Edit" button. Both put the
//  promoter in a mode: they stop looking at their event and start looking at
//  inputs, and they have to leave the mode to find out whether what they typed
//  looks right.
//
//  There is no edit mode here. The promoter is always looking at the EVENT —
//  the real rendering, the real typography — and any single value inside it can
//  be corrected in place. That is what makes review feel like proofreading
//  rather than data entry, and it is why the draft screen can present a
//  finished-looking event instead of a wall of labelled boxes.
//
//  ── What makes it feel right rather than fiddly ───────────────────────────
//  • The reading state is NOT a text input styled to look like text. It is the
//    real text, with a quiet affordance. An always-bordered input everywhere
//    would turn the preview back into a form.
//  • Committing is Enter or blur. Escape reverts. Nothing needs a Save button,
//    because a field that saves on blur cannot be left half-edited.
//  • Optimistic: the new value is on screen before the request resolves, and
//    it rolls back visibly if the write fails. A spinner on every field would
//    make thirty corrections feel like thirty transactions.
//  • The empty state carries a PROMPT, not a blank space — an unread field on
//    a poster is the single most likely thing to be missing, and it has to
//    invite the tap rather than look like a rendering bug.
// ════════════════════════════════════════════════════════════════════════════

export interface InlineFieldProps {
  value: string;
  onCommit: (next: string) => Promise<void> | void;
  /** Shown when the value is empty — the invitation to fill it in. */
  placeholder: string;
  /** Screen-reader name. The visual label is usually the surrounding design. */
  label: string;
  /** Visual weight, matching where it sits in the event's hierarchy. */
  size?: "sm" | "md" | "lg" | "xl";
  multiline?: boolean;
  /** Flags a value extracted with low confidence — see ConfidenceDot. */
  uncertain?: boolean;
  className?: string;
  inputMode?: React.HTMLAttributes<HTMLInputElement>["inputMode"];
  maxLength?: number;
  disabled?: boolean;
}

const SIZES = {
  sm: "text-xs",
  md: "text-sm",
  lg: "font-display text-lg font-bold",
  xl: "font-display text-2xl font-black uppercase tracking-tight sm:text-3xl",
} as const;

export function InlineField({
  value, onCommit, placeholder, label, size = "md", multiline = false,
  uncertain = false, className, inputMode, maxLength = 200, disabled = false,
}: InlineFieldProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const [saving, setSaving] = useState(false);
  const [failed, setFailed] = useState(false);
  const inputRef = useRef<HTMLInputElement | HTMLTextAreaElement>(null);
  const id = useId();

  // NOTE: there is deliberately no effect syncing `draft` to `value`.
  //
  // The draft only exists while editing, and it is seeded from `value` at the
  // moment editing STARTS (see the button's onClick). That removes the whole
  // class of bug where a background save elsewhere rewrites the words under the
  // promoter's cursor — the reading state renders `value` directly, so there is
  // nothing to keep in sync.
  useEffect(() => {
    if (!editing) return;
    const el = inputRef.current;
    if (!el) return;
    el.focus();
    // Caret to the END rather than selecting all: most corrections are a tweak
    // to an OCR misread, not a full retype, and select-all means one stray
    // keystroke destroys a value that was 90% right.
    const len = el.value.length;
    el.setSelectionRange(len, len);
  }, [editing]);

  async function commit() {
    const next = draft.trim();
    setEditing(false);
    if (next === value) return;

    setSaving(true);
    setFailed(false);
    try {
      await onCommit(next);
    } catch {
      // Roll the displayed value back. Leaving the new text on screen after a
      // failed write is the worst outcome: the promoter believes it saved.
      setDraft(value);
      setFailed(true);
    } finally {
      setSaving(false);
    }
  }

  function cancel() {
    setDraft(value);
    setEditing(false);
  }

  if (editing) {
    const shared = {
      ref: inputRef as never,
      id,
      value: draft,
      "aria-label": label,
      maxLength,
      onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setDraft(e.target.value),
      onBlur: commit,
      onKeyDown: (e: React.KeyboardEvent) => {
        if (e.key === "Escape") { e.preventDefault(); cancel(); }
        // Enter commits on a single-line field. On a multiline one it is a
        // newline, and blur is what commits — matching every text area anywhere.
        if (e.key === "Enter" && !multiline) { e.preventDefault(); void commit(); }
      },
      className: cn(
        "w-full rounded-lg border border-blood-500/60 bg-ink-950 px-2.5 py-1.5 text-chalk outline-none ring-2 ring-blood-500/20",
        SIZES[size],
        className,
      ),
    };
    return multiline
      ? <textarea {...shared} rows={3} />
      : <input {...shared} type="text" inputMode={inputMode} />;
  }

  const isEmpty = value.trim().length === 0;

  return (
    <button
      type="button"
      disabled={disabled}
      onClick={() => { setDraft(value); setEditing(true); }}
      aria-label={`${label}. ${isEmpty ? placeholder : value}. Tap to edit.`}
      className={cn(
        // min-h-9 even on the smallest size: this is the most-tapped control in
        // the flow and a text-sized hit target on a phone is a miss.
        "group/inline relative flex min-h-9 w-full items-center gap-2 rounded-lg px-2.5 py-1 text-left transition-colors",
        "hover:bg-ink-800/60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blood-400",
        "disabled:pointer-events-none disabled:opacity-60",
        saving && "opacity-60",
        className,
      )}
    >
      <span className={cn("min-w-0 flex-1 break-words", SIZES[size], isEmpty ? "text-fog italic" : "text-chalk")}>
        {isEmpty ? placeholder : value}
      </span>

      {uncertain && !isEmpty && <ConfidenceDot />}

      {failed && (
        <span role="alert" className="shrink-0 text-3xs font-bold uppercase text-blood-300">
          Not saved
        </span>
      )}

      {/* The affordance. Visible on hover for pointers, and ALWAYS visible on
          touch (where there is no hover) via the media query — a hover-only
          affordance on a phone means the promoter has to already know the text
          is editable to discover that it is. */}
      <Pencil
        aria-hidden
        className="size-3.5 shrink-0 text-fog opacity-0 transition-opacity group-hover/inline:opacity-100 [@media(hover:none)]:opacity-60"
      />
    </button>
  );
}

/**
 * "We read this off the poster but we are not sure."
 *
 * The single most valuable pixel on the review screen. Extraction produces
 * thirty values of wildly differing reliability — a name in 40pt type versus a
 * venue guessed from a comma — and rendered as plain text they all look equally
 * authoritative. This is what turns "check everything" into "check these four",
 * which is the difference between a minute and ten.
 *
 * Colour is not the only signal: it carries a title and an accessible label,
 * because "the amber ones" is useless to a screen reader.
 */
export function ConfidenceDot() {
  return (
    <span
      className="flex shrink-0 items-center gap-1 rounded-full border border-volt-500/40 bg-volt-500/10 px-1.5 py-0.5"
      title="Read from the poster — worth a check"
    >
      <span aria-hidden className="size-1.5 rounded-full bg-volt-400" />
      <span className="sr-only">Low confidence, worth checking</span>
      <span aria-hidden className="font-display text-4xs font-bold uppercase tracking-wider text-volt-200">
        check
      </span>
    </span>
  );
}

/**
 * A field the promoter confirms rather than types: a value with a small set of
 * valid answers (sport, broadcast block, status).
 *
 * Same tap-to-edit contract, so it sits in the same layout as InlineField and
 * the review screen does not switch interaction models halfway down.
 */
export function InlineChoice<T extends string>({
  value, options, onCommit, label, className, disabled = false,
}: {
  value: T;
  options: readonly { value: T; label: string }[];
  onCommit: (next: T) => Promise<void> | void;
  label: string;
  className?: string;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const current = options.find((o) => o.value === value);

  if (!open) {
    return (
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen(true)}
        aria-label={`${label}. ${current?.label ?? "Not set"}. Tap to change.`}
        className={cn(
          "tap inline-flex min-h-9 items-center gap-1.5 rounded-full border border-ink-700 bg-ink-900/60 px-3 text-xs font-semibold text-mist transition-colors hover:border-blood-500/50 hover:text-chalk",
          className,
        )}
      >
        {current?.label ?? "Set"}
        <Pencil aria-hidden className="size-3 text-fog" />
      </button>
    );
  }

  return (
    <div role="radiogroup" aria-label={label} className={cn("flex flex-wrap items-center gap-1.5", className)}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={o.value === value}
          onClick={() => { void onCommit(o.value); setOpen(false); }}
          className={cn(
            "tap min-h-9 rounded-full border px-3 text-xs font-semibold transition-colors",
            o.value === value
              ? "border-blood-500 bg-blood-500 text-white"
              : "border-ink-700 bg-ink-900/60 text-mist hover:border-blood-500/50 hover:text-chalk",
          )}
        >
          {o.label}
        </button>
      ))}
      <button
        type="button"
        onClick={() => setOpen(false)}
        aria-label="Cancel"
        className="tap grid size-9 place-items-center rounded-full text-fog hover:text-chalk"
      >
        <X className="size-4" />
      </button>
    </div>
  );
}

/** Confirm-in-place, for the handful of yes/no facts (title fight, cancelled). */
export function InlineToggle({
  value, onCommit, label, className,
}: {
  value: boolean;
  onCommit: (next: boolean) => Promise<void> | void;
  label: string;
  className?: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={value}
      onClick={() => void onCommit(!value)}
      className={cn(
        "tap inline-flex min-h-9 items-center gap-1.5 rounded-full border px-3 text-xs font-semibold transition-colors",
        value
          ? "border-volt-500/50 bg-volt-500/15 text-volt-200"
          : "border-ink-700 bg-ink-900/60 text-fog hover:text-mist",
        className,
      )}
    >
      {value && <Check aria-hidden className="size-3.5" />}
      {label}
    </button>
  );
}
