"use client";

import { useRef, useState } from "react";
import Image from "next/image";
import { ImagePlus, Loader2, X, RotateCw, FileText, Film, AlertCircle, Link2 } from "lucide-react";
import { parseEmbed } from "@/lib/forum/embeds";
import type { ComposerAttachment, UploadsApi } from "@/lib/composer/attachments";
import { cn } from "@/lib/utils";

// ════════════════════════════════════════════════════════════════════════════
//  The Composer toolbar — an extension point, not a fixed row of buttons.
//
//  ── Why a registry rather than props ──────────────────────────────────────
//  The upcoming list is emoji, GIFs, camera, voice notes, polls, slash
//  commands, event sharing, prediction cards. As boolean props that is
//  `showEmoji showGif showCamera showVoice showPoll…` on every surface, and a
//  `switch` inside the Composer that has to be edited for each one — which is
//  the thing this whole pass exists to stop.
//
//  A toolbar ACTION is a plain object. A feature contributes one from its own
//  file; the Composer renders whatever it is handed and knows nothing about
//  what any of them do. Adding emoji is a new file plus one array entry, with
//  no edit to Composer internals.
//
//  ── Permissions live on the action ────────────────────────────────────────
//  `available: false` removes the button entirely rather than disabling it. A
//  greyed-out control for a feature somebody will never be allowed to use is an
//  advert for a locked door. `disabled` is for the temporary case — at the
//  attachment limit, mid-upload — where the control WILL come back.
// ════════════════════════════════════════════════════════════════════════════

export interface ComposerAction {
  /** Stable identity. Also the React key. */
  id: string;
  /** Lucide icon element. */
  icon: React.ReactNode;
  /** Accessible name and tooltip. Never rendered as visible text — the toolbar
   *  is icon-only so it survives a narrow phone. */
  label: string;
  /** Temporarily unusable (limit reached, upload in flight). */
  disabled?: boolean;
  /** Not permitted at all — the button is not rendered. Defaults to true. */
  available?: boolean;
  onActivate: () => void;
}

/** One icon button. Deliberately not exported — actions are the API. */
function ActionButton({ action }: { action: ComposerAction }) {
  if (action.available === false) return null;
  return (
    <button
      type="button"
      onClick={action.onActivate}
      disabled={action.disabled}
      aria-label={action.label}
      title={action.label}
      className={cn(
        "tap cr-touch-target grid size-9 place-items-center rounded-lg border border-ink-700 bg-ink-950/40 text-mist transition-colors",
        "hover:border-blood-500/40 hover:text-chalk focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blood-400",
        "disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:border-ink-700 disabled:hover:text-mist",
      )}
    >
      {action.icon}
    </button>
  );
}

export function ComposerToolbar({
  actions, className,
}: { actions: ComposerAction[]; className?: string }) {
  const shown = actions.filter((a) => a.available !== false);
  if (shown.length === 0) return null;
  return (
    <div className={cn("flex flex-wrap items-center gap-1.5", className)} role="toolbar" aria-label="Attach">
      {shown.map((a) => <ActionButton key={a.id} action={a} />)}
    </div>
  );
}

/**
 * The MEDIA action — the first toolbar extension, and the template for the rest.
 *
 * It owns its own hidden file input rather than asking the Composer to host
 * one, which is what keeps the Composer ignorant of files: a future emoji
 * action owns a popover the same way, and neither needs the other to exist.
 */
export function useMediaAction<T>(
  uploads: UploadsApi<T>,
  opts: { accept?: string; label?: string; available?: boolean } = {},
): { action: ComposerAction; input: React.ReactNode } {
  const ref = useRef<HTMLInputElement>(null);
  return {
    action: {
      id: "media",
      icon: <ImagePlus className="size-4" aria-hidden />,
      label: opts.label ?? "Attach a photo",
      disabled: uploads.remaining <= 0,
      available: opts.available,
      onActivate: () => ref.current?.click(),
    },
    input: (
      <input
        ref={ref}
        type="file"
        accept={opts.accept ?? "image/*"}
        multiple
        hidden
        onChange={(e) => {
          const files = e.target.files;
          // Reset FIRST: without this, choosing the same file twice in a row
          // fires no change event the second time and looks broken.
          e.target.value = "";
          if (files?.length) uploads.addFiles(files);
        }}
      />
    ),
  };
}

/**
 * The EMBED action — a second extension, and proof the pattern generalises.
 *
 * Nothing about it touches the media action or the Composer: it contributes a
 * button and owns its own popover, exactly as a future emoji picker will. It
 * also demonstrates the non-file path — a parsed link is READY the instant it
 * exists, because there is nothing to upload.
 */
export function useEmbedAction<T>(
  uploads: UploadsApi<T>,
  opts: { available?: boolean } = {},
): { action: ComposerAction; input: React.ReactNode } {
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);

  const add = () => {
    const parsed = parseEmbed(value);
    if (!parsed) { setError("Paste a YouTube, Instagram, X or TikTok link."); return; }
    uploads.addItem({
      name: parsed.type,
      size: 0,
      kind: "embed",
      result: parsed as unknown as T,
    });
    setValue("");
    setError(null);
    setOpen(false);
  };

  return {
    action: {
      id: "embed",
      icon: <Link2 className="size-4" aria-hidden />,
      label: "Embed a link",
      disabled: uploads.remaining <= 0,
      available: opts.available,
      onActivate: () => setOpen((v) => !v),
    },
    input: open ? (
      <div className="mt-2 flex gap-2">
        <label htmlFor="composer-embed" className="sr-only">Link to embed</label>
        <input
          id="composer-embed"
          value={value}
          onChange={(e) => { setValue(e.target.value); setError(null); }}
          // Enter adds the link rather than submitting the surrounding form —
          // otherwise pasting a URL and pressing Enter posts a half-written
          // thread with no embed on it.
          onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); add(); } }}
          autoFocus
          placeholder="Paste a YouTube, Instagram, X or TikTok URL"
          className="min-w-0 flex-1 rounded-lg border border-ink-700 bg-ink-950/50 px-3 py-2 text-sm text-chalk outline-none placeholder:text-fog focus:border-blood-500/50"
        />
        <button
          type="button"
          onClick={add}
          className="rounded-lg bg-blood-500 px-3 py-2 text-xs font-semibold uppercase text-white hover:bg-blood-400"
        >
          Add
        </button>
        {error && <p role="alert" className="sr-only">{error}</p>}
      </div>
    ) : null,
  };
}

// ── Previews ───────────────────────────────────────────────────────────────

function Tile<T>({ a, onRetry, onRemove }: {
  a: ComposerAttachment<T>;
  onRetry: (key: string) => void;
  onRemove: (key: string) => void;
}) {
  const failed = a.stage === "failed";
  const uploading = a.stage === "uploading";

  return (
    <li className="relative">
      <div
        className={cn(
          "relative size-16 overflow-hidden rounded-lg border bg-ink-950",
          failed ? "border-blood-500/60" : "border-ink-700",
        )}
      >
        {a.localUrl && a.kind === "image" ? (
          // The LOCAL url, not the uploaded one: it is already in memory, so the
          // thumbnail is there on the frame the file was chosen.
          <Image src={a.localUrl} alt="" fill sizes="64px" className="object-cover" unoptimized />
        ) : (
          <span className="grid size-full place-items-center text-fog">
            {a.kind === "video" ? <Film className="size-5" aria-hidden /> : <FileText className="size-5" aria-hidden />}
          </span>
        )}

        {uploading && (
          <span className="absolute inset-0 grid place-items-center bg-ink-950/70">
            <Loader2 className="size-4 animate-spin text-chalk" aria-hidden />
          </span>
        )}
        {failed && (
          <span className="absolute inset-0 grid place-items-center bg-ink-950/75">
            <AlertCircle className="size-4 text-blood-300" aria-hidden />
          </span>
        )}

        {/* Progress as a bar rather than a number: at 64px a percentage is
            unreadable, and the bar reads at a glance. */}
        {uploading && (
          <span className="absolute inset-x-0 bottom-0 h-1 bg-ink-800">
            <span
              className="block h-full bg-blood-500 transition-[width] duration-200"
              style={{ width: `${a.progress}%` }}
            />
          </span>
        )}
      </div>

      {/* One live region per attachment, so a screen reader hears the outcome
          rather than watching a bar it cannot see. */}
      <span className="sr-only" role="status" aria-live="polite">
        {a.name}: {failed ? (a.error ?? "upload failed") : uploading ? `uploading ${a.progress}%` : "attached"}
      </span>

      <div className="absolute -right-1.5 -top-1.5 flex gap-0.5">
        {failed && (
          <button
            type="button"
            onClick={() => onRetry(a.key)}
            aria-label={`Retry ${a.name}`}
            title="Retry"
            className="rounded-full bg-ink-800 p-1 text-chalk ring-1 ring-ink-600 transition-colors hover:bg-blood-500"
          >
            <RotateCw className="size-3" aria-hidden />
          </button>
        )}
        <button
          type="button"
          onClick={() => onRemove(a.key)}
          aria-label={`Remove ${a.name}`}
          title="Remove"
          className="rounded-full bg-ink-800 p-1 text-chalk ring-1 ring-ink-600 transition-colors hover:bg-blood-500"
        >
          <X className="size-3" aria-hidden />
        </button>
      </div>
    </li>
  );
}

/**
 * Attachment strip, rendered ABOVE the input by the Composer.
 *
 * Above rather than below because the send button and the toolbar live below:
 * a strip that grows downward pushes the controls under a phone keyboard the
 * moment somebody attaches a second photo.
 */
export function AttachmentPreviews<T>({ uploads }: { uploads: UploadsApi<T> }) {
  if (uploads.attachments.length === 0 && !uploads.error) return null;
  return (
    <div className="mb-2 space-y-1.5">
      {uploads.attachments.length > 0 && (
        <ul className="flex flex-wrap gap-2">
          {uploads.attachments.map((a) => (
            <Tile key={a.key} a={a} onRetry={uploads.retry} onRemove={uploads.remove} />
          ))}
        </ul>
      )}
      {uploads.error && (
        <p role="alert" className="text-xs text-blood-300">{uploads.error}</p>
      )}
    </div>
  );
}
