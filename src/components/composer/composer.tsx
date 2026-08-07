"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import { Loader2, BadgeCheck } from "lucide-react";
import { ForumAvatar } from "@/components/forums/user-identity";
import { applyMention, readMentionToken, type MentionToken } from "@/lib/mentions";
import { readDraft, writeDraft, clearDraft } from "@/lib/composer/drafts";
import { ComposerToolbar, AttachmentPreviews, type ComposerAction } from "@/components/composer/toolbar";
import type { UploadsApi } from "@/lib/composer/attachments";
import type { PresenceDto } from "@/lib/presence/policy";
import { cn } from "@/lib/utils";

// ════════════════════════════════════════════════════════════════════════════
//  THE Composer. The only way a user enters text in this application.
//
//  ── What it replaced ──────────────────────────────────────────────────────
//  Seven textareas across six files, each with its own idea of what typing
//  meant. Only one of them (the DM composer) completed @handles at all, so a
//  mention worked in a DM and was inert prose in a forum reply — the same
//  gesture, two different products. None of the others persisted a draft, so
//  navigating away from a half-written gym review lost it silently.
//
//  ── The one keyboard contract ─────────────────────────────────────────────
//  Every key below means two things depending on whether the mention menu is
//  open, which is precisely why it cannot live in six places:
//
//    Enter      picks the highlighted person, else submits (see submitOnEnter)
//    Tab        picks the highlighted person, else moves focus normally
//    ArrowUp/Dn moves the highlight, else moves the caret
//    Escape     closes the menu, else falls through to the sheet/dialog above
//    Shift+Enter is always a newline, never a submit
//
//  The component owns `onKeyDown` outright and forwards to the host ONLY when
//  the menu is closed, so a host writes its submit handler as though mentions
//  did not exist.
//
//  ── Enter-to-send is configured, not re-implemented ───────────────────────
//  `submitOnEnter` is the single switch, and it is set by the KIND of surface:
//
//    chat-like (DM, comments)  → Enter sends. Messages are short and fast.
//    document (review, thread) → Enter is a paragraph; Cmd/Ctrl+Enter submits.
//
//  This is deliberate and it is not an inconsistency. Enter-to-send on a
//  four-paragraph gym review would eat the review on the first line break, and
//  a rule people learn once ("Enter sends where you chat, Cmd+Enter where you
//  write") is better than one that silently destroys long text. The BEHAVIOUR
//  is identical everywhere; only this flag differs, and it is read from one
//  place.
//
//  ── Extending it ──────────────────────────────────────────────────────────
//  Emoji, GIFs, attachments, voice notes, slash commands and formatting all
//  belong HERE, as toolbar slots and additional trigger tokens beside `@`. A
//  surface should never grow its own.
// ════════════════════════════════════════════════════════════════════════════

/** Matches the challenge picker and the site-wide search overlay. */
const DEBOUNCE_MS = 180;
/** Drafts are written at most this often, not on every keystroke. */
const DRAFT_DEBOUNCE_MS = 400;

interface MentionPerson {
  username: string;
  name: string;
  image: string | null;
  verified?: boolean;
  presence?: PresenceDto | null;
}

export interface ComposerProps {
  value: string;
  onChange: (next: string) => void;
  /**
   * Called by Enter (chat surfaces) or Cmd/Ctrl+Enter (document surfaces).
   * Omit on a composer whose only submit path is a button.
   */
  onSubmit?: () => void;
  /**
   * Enter submits. TRUE for chat-like surfaces, FALSE for long-form ones.
   * See the note above — this is the one knob, not a second implementation.
   */
  submitOnEnter?: boolean;
  /**
   * Namespace for draft persistence. Omit to disable it entirely (an EDIT box
   * must not restore a draft over content that already exists).
   */
  draftKey?: string;
  /** Hard ceiling. Enforced on input, not just on submit. */
  maxLength?: number;
  /** Show the remaining count once the text approaches the ceiling. */
  showCount?: boolean;
  /**
   * Attachments, when this surface has them.
   *
   * The SURFACE owns the state (it has to submit it alongside the text); the
   * Composer owns the interaction — previews, the toolbar button, drag-and-drop
   * and the paste path. That split is why there is no callback here: the
   * surface already holds everything it needs.
   */
  uploads?: UploadsApi<unknown>;
  /**
   * Extra toolbar actions, contributed by features.
   *
   * Emoji, GIFs, polls and the rest arrive HERE as objects. The Composer never
   * learns what any of them do, so adding one is a new file plus an array
   * entry, not an edit to this component.
   */
  actions?: ComposerAction[];
  /** Rendered to the right of the toolbar — a surface's own send button. */
  trailing?: React.ReactNode;
  className?: string;
  disabled?: boolean;
}

export function Composer({
  value,
  onChange,
  onSubmit,
  submitOnEnter = false,
  draftKey,
  maxLength,
  showCount = false,
  uploads,
  actions,
  trailing,
  className,
  disabled,
  ...rest
}: ComposerProps &
  Omit<
    React.TextareaHTMLAttributes<HTMLTextAreaElement>,
    "value" | "onChange" | "onSubmit" | "className" | "disabled" | "maxLength"
  >) {
  const ref = useRef<HTMLTextAreaElement>(null);
  /**
   * The handle fragment being typed, and where it starts.
   *
   * Computed in the CHANGE HANDLER, not in an effect and not during render.
   * Both alternatives are wrong for the same reason: the token depends on the
   * CARET, and the caret only exists on the DOM node. Reading it during render
   * is a ref access during render and can be a frame stale; reading it in an
   * effect costs an extra render per keystroke on the app's most
   * latency-sensitive input. The change event carries both the new value and
   * the new caret, which is exactly and only what this needs.
   */
  const [token, setToken] = useState<MentionToken | null>(null);
  const query = token?.text ?? null;
  const [people, setPeople] = useState<MentionPerson[]>([]);
  const [loading, setLoading] = useState(false);
  const [active, setActive] = useState(0);
  /**
   * Only the newest request may write state. Keystrokes issue overlapping
   * requests and they do not return in order — a two-character query can land
   * after the five-character one and overwrite the right list with a stale one.
   */
  const seq = useRef(0);

  const open = query !== null && people.length > 0;

  // ── Draft restore ────────────────────────────────────────────────────────
  // Once, on mount, and ONLY into an empty composer: restoring over text the
  // caller supplied (an edit box pre-filled with the existing post) would
  // silently replace real content with an old draft.
  const restored = useRef(false);
  useEffect(() => {
    if (!draftKey || restored.current) return;
    restored.current = true;
    if (value) return;
    const saved = readDraft(draftKey);
    if (saved) onChange(saved);
    // `value`/`onChange` are deliberately not dependencies — this must run once
    // per mount, not every time the text changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draftKey]);

  // ── Draft save ───────────────────────────────────────────────────────────
  // Debounced: a keystroke-rate localStorage write is a synchronous main-thread
  // hit on every character typed.
  useEffect(() => {
    if (!draftKey || !restored.current) return;
    const t = setTimeout(() => writeDraft(draftKey, value), DRAFT_DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [draftKey, value]);

  /**
   * Read the in-progress handle from a change event.
   *
   * Deliberately NOT recomputed on selection changes: moving the caret into the
   * middle of an @handle the reader already finished writing should not reopen
   * a picker over it.
   */
  const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const raw = e.target.value;
    // Truncate on INPUT rather than only refusing at submit — a limit somebody
    // discovers after writing 400 words past it is not a limit, it is a trap.
    const next = maxLength ? raw.slice(0, maxLength) : raw;
    onChange(next);

    // A selection (rather than a caret) is not a position to complete at.
    if (e.target.selectionStart !== e.target.selectionEnd) { setToken(null); return; }
    setToken(readMentionToken(next, e.target.selectionStart ?? next.length));
    setActive(0);
  };

  useEffect(() => {
    if (query === null) { setPeople([]); return; }
    const timer = setTimeout(async () => {
      const mine = ++seq.current;
      setLoading(true);
      try {
        const res = await fetch(`/api/users/search?q=${encodeURIComponent(query)}`);
        if (mine !== seq.current) return;
        const data = res.ok ? await res.json() : null;
        setPeople(Array.isArray(data?.people) ? data.people : []);
      } catch {
        if (mine === seq.current) setPeople([]);
      } finally {
        if (mine === seq.current) setLoading(false);
      }
    }, DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [query]);

  const choose = useCallback((person: MentionPerson) => {
    const el = ref.current;
    if (!el || !token) return;

    const { text: next, caret } = applyMention(value, token, person.username);
    onChange(next);
    setToken(null);
    setPeople([]);

    // The caret has to be restored AFTER React has written the new value, or
    // the browser puts it at the end of the whole textarea — wrong for anyone
    // mentioning somebody mid-sentence.
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(caret, caret);
    });
  }, [token, value, onChange]);

  const submit = useCallback(() => {
    onSubmit?.();
    // The draft is the unsent thing. Once it is sent there is nothing to
    // restore, and leaving it would repopulate the box with what was just said.
    if (draftKey) clearDraft(draftKey);
  }, [onSubmit, draftKey]);

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (open) {
      if (e.key === "ArrowDown") { e.preventDefault(); setActive((i) => (i + 1) % people.length); return; }
      if (e.key === "ArrowUp") { e.preventDefault(); setActive((i) => (i - 1 + people.length) % people.length); return; }
      if (e.key === "Enter" || e.key === "Tab") {
        e.preventDefault();
        // `active` can point past the end: a debounced response can replace the
        // list with a shorter one between the keypress being aimed and handled.
        // Falling back to the first row beats calling choose(undefined).
        const person = people[active] ?? people[0];
        if (person) choose(person);
        return;
      }
      if (e.key === "Escape") {
        // stopPropagation, so closing the menu does not ALSO close the sheet or
        // dialog this composer sits in. Two dismissals from one press is the
        // classic nested-overlay bug.
        e.preventDefault();
        e.stopPropagation();
        setToken(null);
        setPeople([]);
        return;
      }
    }

    if (onSubmit && e.key === "Enter" && !e.shiftKey) {
      // Cmd/Ctrl+Enter submits on EVERY surface, including the chat-like ones.
      // It is the one shortcut that always means "send", so a person who learns
      // it never has to know which kind of surface they are on.
      if (submitOnEnter || e.metaKey || e.ctrlKey) {
        e.preventDefault();
        submit();
        return;
      }
    }
    rest.onKeyDown?.(e);
  };

  // useId, not Math.random(): stable across renders, unique per instance, and
  // identical on server and client so it cannot trip a hydration mismatch on an
  // aria-controls attribute.
  // ── Drag and drop ────────────────────────────────────────────────────────
  // Counted rather than a boolean: dragenter/dragleave fire for every CHILD
  // element crossed, so a boolean flickers off the moment the pointer moves
  // over the textarea inside the drop zone.
  const dragDepth = useRef(0);
  const [dragging, setDragging] = useState(false);

  const onDragEnter = (e: React.DragEvent) => {
    if (!uploads || !e.dataTransfer.types.includes("Files")) return;
    e.preventDefault();
    dragDepth.current += 1;
    setDragging(true);
  };
  const onDragLeave = () => {
    if (!uploads) return;
    dragDepth.current = Math.max(0, dragDepth.current - 1);
    if (dragDepth.current === 0) setDragging(false);
  };
  const onDrop = (e: React.DragEvent) => {
    if (!uploads) return;
    e.preventDefault();
    dragDepth.current = 0;
    setDragging(false);
    if (e.dataTransfer.files.length) uploads.addFiles(e.dataTransfer.files);
  };

  const listId = `mentions-${useId()}`;
  const remaining = maxLength ? maxLength - value.length : null;
  // Only speak up near the ceiling. A counter present from the first character
  // reads as a warning about text nobody has written yet.
  const nearLimit = remaining !== null && maxLength !== undefined && remaining <= Math.max(20, maxLength * 0.1);

  return (
    <div
      className="relative flex-1"
      onDragEnter={onDragEnter}
      onDragOver={(e) => { if (uploads && e.dataTransfer.types.includes("Files")) e.preventDefault(); }}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
    >
      {uploads && <AttachmentPreviews uploads={uploads} />}

      {open && (
        /* ABOVE the input. Composers sit at the BOTTOM of their surface — a DM
           thread, a reply box — so a menu dropped downward would open into the
           keyboard on a phone and off-screen on a laptop. */
        <ul
          id={listId}
          role="listbox"
          aria-label="People"
          className="cr-overscroll-contain absolute bottom-full left-0 z-30 mb-2 max-h-56 w-full min-w-56 overflow-y-auto rounded-xl border border-ink-700 bg-ink-900/98 p-1 shadow-[0_18px_40px_-12px_rgba(0,0,0,0.85)] backdrop-blur-xl"
        >
          {people.map((p, i) => (
            <li key={p.username}>
              <button
                type="button"
                role="option"
                aria-selected={i === active}
                // pointerDown, not click: `click` fires after `blur`, and the
                // blur would have already torn the menu down.
                onPointerDown={(e) => { e.preventDefault(); choose(p); }}
                onMouseEnter={() => setActive(i)}
                className={cn(
                  "tap flex min-h-12 w-full items-center gap-2.5 rounded-lg px-2 text-left transition-colors",
                  i === active ? "bg-blood-500/15 text-chalk" : "text-mist hover:bg-ink-800",
                )}
              >
                {/* Presence in the picker: mentioning somebody who is here now
                    is a different act from mentioning somebody who will read it
                    tomorrow. showOffline=false — a short list of grey dots is
                    noise. */}
                <ForumAvatar
                  name={p.name}
                  image={p.image}
                  size="sm"
                  presence={p.presence ?? null}
                  showOffline={false}
                />
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-1">
                    <span className="truncate font-display text-sm font-bold text-chalk">{p.name}</span>
                    {p.verified && <BadgeCheck aria-label="Verified" className="size-3.5 shrink-0 text-volt-400" />}
                  </span>
                  <span className="block truncate text-xs text-fog">@{p.username}</span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}

      <textarea
        {...rest}
        ref={ref}
        value={value}
        disabled={disabled}
        onChange={handleChange}
        onKeyDown={onKeyDown}
        role="combobox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        aria-autocomplete="list"
        className={className}
      />

      {loading && query !== null && (
        <Loader2 aria-hidden className="pointer-events-none absolute right-2.5 top-3 size-3.5 animate-spin text-fog" />
      )}

      {/* The drop target is the whole composer, so there is no small rectangle
          to aim at. `pointer-events-none` matters: an overlay that swallowed
          the drop would make the gesture do nothing. */}
      {dragging && (
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 z-20 grid place-items-center rounded-lg border-2 border-dashed border-blood-500/70 bg-ink-950/80"
        >
          <span className="font-display text-xs font-bold uppercase tracking-wider text-blood-200">
            Drop to attach
          </span>
        </div>
      )}

      {(actions?.length || uploads || trailing) && (
        <div className="mt-2 flex items-center gap-2">
          <ComposerToolbar actions={actions ?? []} />
          {trailing && <span className="ml-auto">{trailing}</span>}
        </div>
      )}

      {showCount && nearLimit && (
        <p
          className={cn("mt-1 text-right text-3xs tabular-nums", remaining! <= 0 ? "text-blood-300" : "text-fog")}
          role="status"
          aria-live="polite"
        >
          {remaining} left
        </p>
      )}
    </div>
  );
}
