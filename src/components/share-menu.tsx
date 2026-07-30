"use client";

import { useRef, useState } from "react";
import { Send, Check, Copy, Mail, Link2 } from "lucide-react";
import { PopoverMenu, popoverItemClass } from "@/components/ui/popover-menu";
import { cn } from "@/lib/utils";

// ONE share control for the whole product — events, fights, fighters, rankings,
// threads. It takes a site-relative `path` and resolves the absolute URL from
// the live origin, so it works identically on localhost, preview and production
// without any config. `onShared` is how a surface records its own analytics
// (the forum increments shareCount for trending); nothing else is surface-aware.

type Channel = { key: string; label: string; href: (u: string, t: string) => string };

const enc = encodeURIComponent;

// WhatsApp first: it is where a fight card actually gets shared, and the order of
// this list is the order of the menu.
const CHANNELS: Channel[] = [
  { key: "whatsapp", label: "WhatsApp", href: (u, t) => `https://wa.me/?text=${enc(`${t} ${u}`)}` },
  { key: "x", label: "X", href: (u, t) => `https://twitter.com/intent/tweet?url=${enc(u)}&text=${enc(t)}` },
  { key: "facebook", label: "Facebook", href: (u) => `https://www.facebook.com/sharer/sharer.php?u=${enc(u)}` },
  { key: "reddit", label: "Reddit", href: (u, t) => `https://www.reddit.com/submit?url=${enc(u)}&title=${enc(t)}` },
  { key: "telegram", label: "Telegram", href: (u, t) => `https://t.me/share/url?url=${enc(u)}&text=${enc(t)}` },
  { key: "linkedin", label: "LinkedIn", href: (u) => `https://www.linkedin.com/sharing/share-offsite/?url=${enc(u)}` },
  // Discord has no web share intent, so the honest option is a pre-composed message
  // on the clipboard rather than a button that opens nothing.
];

const absolute = (path: string): string =>
  typeof window === "undefined" ? path : `${window.location.origin}${path}`;

export function ShareMenu({
  path, title, compact, label = "Share", onShared, className,
}: {
  /** Site-relative path, e.g. "/events/ufc-300". */
  path: string;
  title: string;
  compact?: boolean;
  label?: string;
  /** Fire-and-forget hook for the surface's own share analytics. */
  onShared?: () => void;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);

  async function onButton() {
    if (open) { setOpen(false); return; }

    const url = absolute(path);
    // Native share sheet (mobile) — one tap to every installed app.
    if (typeof navigator !== "undefined" && navigator.share) {
      try {
        await navigator.share({ title, url });
        onShared?.();
        return;
      } catch (e) {
        // CANCELLING the native sheet must not then open our own menu.
        //
        // The old code caught every rejection and fell through to `setOpen`, so the
        // sequence "tap Share → native sheet → swipe it away" ended with the
        // dropdown appearing — seconds after the tap, with no apparent cause. That
        // is the "share options show up after" symptom: not a slow menu, a menu
        // opened by the dismissal of the sheet.
        //
        // AbortError is the user saying no. Anything else (share not permitted for
        // this data, no target app) is a real failure, and falling back to our own
        // channel list is the correct response to it.
        if ((e as Error)?.name === "AbortError") return;
      }
    }
    setOpen(true);
  }

  function openChannel(c: Channel) {
    window.open(c.href(absolute(path), title), "_blank", "noopener,noreferrer,width=600,height=520");
    onShared?.();
    setOpen(false);
  }

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(absolute(path));
      setCopied(true);
      onShared?.();
      setTimeout(() => setCopied(false), 1800);
    } catch { /* clipboard denied — the channel list is still there */ }
  }

  return (
    <div className={cn("relative", className)}>
      <button
        ref={buttonRef}
        type="button"
        onClick={onButton}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={compact ? label : undefined}
        className="inline-flex items-center gap-1.5 rounded-lg border border-ink-700 px-2.5 py-1.5 text-xs font-semibold text-fog transition-colors hover:border-blood-500/40 hover:text-blood-300 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blood-400"
      >
        <Send className="size-3.5" /> {!compact && label}
      </button>

      {/* Portalled: the event card that hosts this is `overflow-hidden`, which used
          to clip the menu out of existence on mobile. See ui/popover-menu. */}
      <PopoverMenu open={open} onClose={() => setOpen(false)} anchorRef={buttonRef} label="Share to">
        {CHANNELS.map((c) => (
          <button key={c.key} type="button" role="menuitem" onClick={() => openChannel(c)} className={popoverItemClass}>
            {c.label}
          </button>
        ))}
        <a
          role="menuitem"
          href={`mailto:?subject=${enc(title)}&body=${enc(absolute(path))}`}
          onClick={() => { onShared?.(); setOpen(false); }}
          className={popoverItemClass}
        >
          <Mail className="size-4" /> Email
        </a>
        <button type="button" role="menuitem" onClick={copyLink} className={popoverItemClass}>
          {copied ? <Check className="size-4 text-up" /> : <Link2 className="size-4" />} {copied ? "Copied!" : "Copy link"}
        </button>
      </PopoverMenu>
    </div>
  );
}

/** Standalone "Copy link" button. */
export function CopyLinkButton({ path }: { path: string }) {
  const [copied, setCopied] = useState(false);
  async function copy() {
    try { await navigator.clipboard.writeText(absolute(path)); setCopied(true); setTimeout(() => setCopied(false), 1800); } catch { /* ignore */ }
  }
  return (
    <button type="button" onClick={copy}
      className="inline-flex items-center gap-1.5 rounded-lg border border-ink-700 px-2.5 py-1.5 text-xs font-semibold text-fog transition-colors hover:border-blood-500/40 hover:text-blood-300 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blood-400">
      {copied ? <Check className="size-3.5 text-up" /> : <Copy className="size-3.5" />} {copied ? "Copied" : "Copy link"}
    </button>
  );
}
